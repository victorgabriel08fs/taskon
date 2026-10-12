import 'server-only';

import { addAppDays } from '@/lib/timezone';
import { db, type Executor } from '@/server/db';
import {
    boardLists,
    boardUser,
    boards,
    cardLabel,
    cardUser,
    cards,
    checklistItems,
    checklists,
    comments,
    labels,
    type BoardRow,
    type UserRow,
} from '@/server/db/schema';
import { logActivity } from '@/server/services/activity';
import type { ColorKey } from '@/types';

/**
 * Monta um quadro de boas-vindas para contas novas — o antigo
 * `DemoBoardBuilder`. O objetivo é que a primeira tela do usuário já tenha
 * conteúdo para arrastar.
 *
 * Também é a base do seed (scripts/seed.ts), que monta dois destes para a
 * conta de demonstração.
 */

const LABELS = [
    ['Design', 'violet'],
    ['Backend', 'blue'],
    ['Urgente', 'rose'],
    ['Melhoria', 'emerald'],
    ['Ideia', 'amber'],
] as const satisfies readonly (readonly [string, ColorKey])[];

type LabelName = (typeof LABELS)[number][0];

interface BlueprintCard {
    title: string;
    labels: LabelName[];
    /** Prazo em dias a partir de agora; null = sem prazo. */
    dueInDays: number | null;
}

const DONE_LIST = 'Concluído';

const BLUEPRINT: { title: string; cards: BlueprintCard[] }[] = [
    {
        title: 'Ideias',
        cards: [
            { title: 'Modo foco com atalho de teclado', labels: ['Ideia'], dueInDays: null },
            { title: 'Exportar quadro em PDF', labels: ['Ideia', 'Melhoria'], dueInDays: null },
        ],
    },
    {
        title: 'A fazer',
        cards: [
            { title: 'Revisar textos da página inicial', labels: ['Design'], dueInDays: 3 },
            { title: 'Criar etiquetas do time', labels: ['Melhoria'], dueInDays: null },
            { title: 'Configurar backup do banco', labels: ['Backend', 'Urgente'], dueInDays: 1 },
        ],
    },
    {
        title: 'Em andamento',
        cards: [{ title: 'Arrastar e soltar entre colunas', labels: ['Design', 'Backend'], dueInDays: 2 }],
    },
    {
        title: DONE_LIST,
        cards: [{ title: 'Instalar o Taskon localmente', labels: ['Backend'], dueInDays: null }],
    },
];

/** O card que ganha a checklist e o comentário de exemplo. */
const TOUR_CARD = 'Arrastar e soltar entre colunas';

const TOUR_STEPS: [content: string, done: boolean][] = [
    ['Arraste este card para outra coluna', true],
    ['Reordene as colunas pelo cabeçalho', false],
    ['Abra o card e escreva uma descrição', false],
];

function idOf(ids: Map<string, number>, key: string): number {
    const value = ids.get(key);

    if (value === undefined) throw new Error(`Quadro de exemplo: "${key}" não foi criado.`);

    return value;
}

/**
 * Cria o quadro, as etiquetas, as colunas e os cards de exemplo numa
 * transação só — ou vem tudo, ou nada.
 *
 * `executor` permite montar o quadro dentro de uma transação maior (o
 * cadastro cria a conta e o quadro juntos); aí esta vira um savepoint.
 *
 * As inserções vão em lote (uma por tabela, e não uma por linha como no
 * Eloquent): em serverless cada consulta é uma ida e volta até o banco.
 */
export async function buildDemoBoard(
    user: Pick<UserRow, 'id'>,
    title = 'Meu primeiro quadro',
    executor: Executor = db,
): Promise<BoardRow> {
    return executor.transaction(async (tx) => {
        const now = new Date();

        const [board] = await tx
            .insert(boards)
            .values({
                ownerId: user.id,
                title,
                description: 'Arraste os cards entre as colunas para ver a mágica acontecer.',
                background: 'aurora',
            })
            .returning();

        await tx.insert(boardUser).values({ boardId: board.id, userId: user.id, role: 'owner', lastOpenedAt: now });

        // Uma inserção só, na ordem da lista: os ids saem crescentes, que é a
        // ordem em que o quadro mostra as etiquetas.
        const labelRows = await tx
            .insert(labels)
            .values(LABELS.map(([name, color]) => ({ boardId: board.id, name, color })))
            .returning({ id: labels.id, name: labels.name });

        const labelIds = new Map(labelRows.map((label) => [label.name ?? '', label.id]));

        const listRows = await tx
            .insert(boardLists)
            .values(
                BLUEPRINT.map((list, index) => ({
                    boardId: board.id,
                    title: list.title,
                    position: index + 1,
                    isDone: list.title === DONE_LIST,
                })),
            )
            .returning({ id: boardLists.id, title: boardLists.title });

        const listIds = new Map(listRows.map((list) => [list.title, list.id]));

        const cardRows = await tx
            .insert(cards)
            .values(
                BLUEPRINT.flatMap((list) =>
                    list.cards.map((card, index) => ({
                        boardId: board.id,
                        boardListId: idOf(listIds, list.title),
                        createdBy: user.id,
                        title: card.title,
                        position: index + 1,
                        // Dias de calendário no fuso do app, mantendo a hora
                        // de parede — o `now()->addDays()` do Carbon.
                        dueAt: card.dueInDays === null ? null : addAppDays(now, card.dueInDays),
                        completedAt: list.title === DONE_LIST ? now : null,
                    })),
                ),
            )
            .returning({ id: cards.id, title: cards.title });

        const cardIds = new Map(cardRows.map((card) => [card.title, card.id]));

        await tx.insert(cardLabel).values(
            BLUEPRINT.flatMap((list) =>
                list.cards.flatMap((card) =>
                    card.labels.map((name) => ({ cardId: idOf(cardIds, card.title), labelId: idOf(labelIds, name) })),
                ),
            ),
        );

        // Quem cria o quadro de exemplo é responsável por todos os cards dele.
        await tx.insert(cardUser).values(cardRows.map((card) => ({ cardId: card.id, userId: user.id })));

        const tourCardId = idOf(cardIds, TOUR_CARD);

        const [checklist] = await tx
            .insert(checklists)
            .values({ cardId: tourCardId, title: 'Passo a passo', position: 1 })
            .returning({ id: checklists.id });

        await tx.insert(checklistItems).values(
            TOUR_STEPS.map(([content, isDone], index) => ({
                checklistId: checklist.id,
                content,
                isDone,
                position: index + 1,
            })),
        );

        await tx.insert(comments).values({
            cardId: tourCardId,
            userId: user.id,
            body: 'Bem-vindo ao Taskon! Este é um comentário de exemplo — pode apagar.',
        });

        await logActivity(
            { boardId: board.id, userId: user.id, type: 'board.created', description: `criou o quadro ${board.title}` },
            tx,
        );

        return board;
    });
}
