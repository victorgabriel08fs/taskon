import 'server-only';

import { and, eq, not } from 'drizzle-orm';
import type { BoardBackground, ColorKey } from '@/types';
import { pluralize } from '@/lib/utils';
import { config } from '@/server/config';
import { db } from '@/server/db';
import { boardLists, boardUser, boards, labels, type BoardRow, type UserRow } from '@/server/db/schema';
import { invalid } from '@/server/errors';
import { authorizeBoard } from '@/server/policies/board';
import { logActivity } from '@/server/services/activity';

/**
 * Quadros: criar, ajustar, excluir e favoritar — a regra que morava no
 * `BoardController`. Membros em services/members.ts; listas em services/lists.ts.
 */

/** As etiquetas com que todo quadro novo nasce, nesta ordem. */
const DEFAULT_LABELS = [
    { name: 'Verde', color: 'emerald' },
    { name: 'Urgente', color: 'rose' },
    { name: 'Ideia', color: 'violet' },
    { name: 'Bloqueado', color: 'amber' },
] as const satisfies readonly { name: string; color: ColorKey }[];

/** As colunas com que todo quadro novo nasce, da esquerda para a direita. */
const DEFAULT_LISTS = ['A fazer', 'Em andamento', 'Concluído'] as const;

/** A coluna de conclusão entre as padrão. */
const DONE_LIST: (typeof DEFAULT_LISTS)[number] = 'Concluído';

/**
 * Cria o quadro já pronto para usar: o dono como membro `owner`, as etiquetas
 * e as três colunas padrão. Quadro, membro, etiquetas e listas nascem juntos
 * ou não nascem — daí a transação.
 */
export async function createBoard(
    actor: Pick<UserRow, 'id'>,
    input: { title: string; background: BoardBackground },
    now: Date = new Date(),
): Promise<BoardRow> {
    return db.transaction(async (tx) => {
        const board = (
            await tx.insert(boards).values({ ownerId: actor.id, title: input.title, background: input.background }).returning()
        )[0]!;

        await tx.insert(boardUser).values({ boardId: board.id, userId: actor.id, role: 'owner', lastOpenedAt: now });

        await tx.insert(labels).values(DEFAULT_LABELS.map((label) => ({ boardId: board.id, name: label.name, color: label.color })));

        await tx.insert(boardLists).values(
            DEFAULT_LISTS.map((title, index) => ({
                boardId: board.id,
                title,
                position: index + 1,
                // Arrastar para cá marca o card como concluído. Sem isso, a
                // coluna seria só um nome e o painel contaria os cards de lá
                // como abertos.
                isDone: title === DONE_LIST,
            })),
        );

        await logActivity(
            { boardId: board.id, userId: actor.id, type: 'board.created', description: `criou o quadro ${board.title}` },
            tx,
        );

        return board;
    });
}

export interface BoardChanges {
    title?: string;
    description?: string | null;
    background?: BoardBackground;
    /**
     * Ausente = não mexe; `null` = desliga (é o jeito de desligar, por isso não
     * é obrigatório); número = um dos prazos de `config.autoArchive.options`.
     */
    auto_archive_done_after_days?: number | null;
}

/** Só os campos enviados mudam. Configurações do quadro: owner/admin. */
export async function updateBoard(actor: Pick<UserRow, 'id'>, boardId: number, input: BoardChanges): Promise<void> {
    const { board } = await authorizeBoard(actor, boardId, 'manage');

    const days = input.auto_archive_done_after_days;

    // A lista de prazos é a mesma que a tela oferece: um prazo fora dela é
    // um prazo que a tela nem saberia mostrar.
    if (typeof days === 'number' && !(config.autoArchive.options as readonly number[]).includes(days)) {
        invalid('auto_archive_done_after_days', 'Escolha um dos prazos oferecidos.');
    }

    // Só o que mudou de fato (o "dirty" do Eloquent): reenviar o mesmo valor
    // não grava nada nem conta como troca de prazo.
    const changes: Partial<typeof boards.$inferInsert> = {};

    if (input.title !== undefined && input.title !== board.title) changes.title = input.title;
    if (input.description !== undefined && input.description !== board.description) changes.description = input.description;
    if (input.background !== undefined && input.background !== board.background) changes.background = input.background;
    if (days !== undefined && days !== board.autoArchiveDoneAfterDays) changes.autoArchiveDoneAfterDays = days;

    if (Object.keys(changes).length === 0) return;

    await db.transaction(async (tx) => {
        await tx.update(boards).set(changes).where(eq(boards.id, board.id));

        // Cards sumindo sozinhos é o tipo de coisa que assusta quem não estava
        // na sala quando foi ligada. A troca de prazo fica no histórico do
        // quadro para a resposta estar lá quando alguém perguntar.
        if (changes.autoArchiveDoneAfterDays !== undefined) {
            const after = changes.autoArchiveDoneAfterDays;

            await logActivity(
                {
                    boardId: board.id,
                    userId: actor.id,
                    type: 'board.auto_archive',
                    description:
                        after === null
                            ? 'desligou o arquivamento automático dos concluídos'
                            : `passou a arquivar os concluídos depois de ${pluralize(after, 'dia', 'dias')}`,
                    properties: { after_days: after },
                },
                tx,
            );
        }
    });
}

/** Só o dono exclui. Listas, cards, etiquetas, membros e histórico vão junto (ON DELETE CASCADE). */
export async function deleteBoard(actor: Pick<UserRow, 'id'>, boardId: number): Promise<void> {
    const { board } = await authorizeBoard(actor, boardId, 'delete');

    await db.delete(boards).where(eq(boards.id, board.id));
}

/**
 * Favorito é por pessoa: só a linha de board_user de quem clicou muda. Inverter
 * no próprio UPDATE (em vez de ler e depois gravar) não deixa dois cliques
 * rápidos se atropelarem. Devolve o estado novo.
 */
export async function toggleFavorite(actor: Pick<UserRow, 'id'>, boardId: number): Promise<boolean> {
    const { board } = await authorizeBoard(actor, boardId, 'view');

    const [row] = await db
        .update(boardUser)
        .set({ isFavorite: not(boardUser.isFavorite) })
        .where(and(eq(boardUser.boardId, board.id), eq(boardUser.userId, actor.id)))
        .returning({ isFavorite: boardUser.isFavorite });

    return row?.isFavorite ?? false;
}
