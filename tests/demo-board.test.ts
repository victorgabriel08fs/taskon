import { asc, eq, inArray } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toAppIso } from '@/lib/timezone';
import { db } from '@/server/db';
import {
    activities,
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
} from '@/server/db/schema';
import { buildDemoBoard } from '@/server/services/demo-board';
import { createUser } from './support/factories';

/**
 * O quadro de boas-vindas (o antigo `DemoBoardBuilder`): é a primeira tela de
 * toda conta nova, então o conteúdo dele é contrato.
 */
describe('buildDemoBoard', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('cria o quadro com o dono como membro', async () => {
        const user = await createUser();
        const board = await buildDemoBoard(user);

        expect(board).toMatchObject({
            ownerId: user.id,
            title: 'Meu primeiro quadro',
            description: 'Arraste os cards entre as colunas para ver a mágica acontecer.',
            background: 'aurora',
            autoArchiveDoneAfterDays: null,
        });

        const members = await db.select().from(boardUser).where(eq(boardUser.boardId, board.id));

        expect(members).toHaveLength(1);
        expect(members[0]).toMatchObject({ userId: user.id, role: 'owner', isFavorite: false });
        expect(members[0]?.lastOpenedAt).toBeInstanceOf(Date);
    });

    it('aceita outro título (o seed usa "Lançamento do Taskon" e "Pessoal")', async () => {
        const user = await createUser();
        const board = await buildDemoBoard(user, 'Pessoal');

        expect(board.title).toBe('Pessoal');

        const [activity] = await db.select().from(activities).where(eq(activities.boardId, board.id));

        expect(activity?.description).toBe('criou o quadro Pessoal');
    });

    it('cria as cinco etiquetas na ordem do legado', async () => {
        const user = await createUser();
        const board = await buildDemoBoard(user);

        const rows = await db
            .select({ name: labels.name, color: labels.color })
            .from(labels)
            .where(eq(labels.boardId, board.id))
            .orderBy(asc(labels.id));

        expect(rows).toEqual([
            { name: 'Design', color: 'violet' },
            { name: 'Backend', color: 'blue' },
            { name: 'Urgente', color: 'rose' },
            { name: 'Melhoria', color: 'emerald' },
            { name: 'Ideia', color: 'amber' },
        ]);
    });

    it('cria as quatro colunas, só a última como coluna de conclusão', async () => {
        const user = await createUser();
        const board = await buildDemoBoard(user);

        const rows = await db
            .select({ title: boardLists.title, position: boardLists.position, isDone: boardLists.isDone })
            .from(boardLists)
            .where(eq(boardLists.boardId, board.id))
            .orderBy(asc(boardLists.position));

        expect(rows).toEqual([
            { title: 'Ideias', position: 1, isDone: false },
            { title: 'A fazer', position: 2, isDone: false },
            { title: 'Em andamento', position: 3, isDone: false },
            { title: 'Concluído', position: 4, isDone: true },
        ]);
    });

    it('distribui os cards com etiquetas, prazos, conclusão e responsável', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-12T13:00:00Z'));

        const user = await createUser();
        const board = await buildDemoBoard(user);
        const now = new Date();

        const rows = await db
            .select({
                id: cards.id,
                title: cards.title,
                list: boardLists.title,
                position: cards.position,
                dueAt: cards.dueAt,
                completedAt: cards.completedAt,
                createdBy: cards.createdBy,
            })
            .from(cards)
            .innerJoin(boardLists, eq(boardLists.id, cards.boardListId))
            .where(eq(cards.boardId, board.id))
            .orderBy(asc(boardLists.position), asc(cards.position));

        expect(rows.map(({ title, list, position }) => ({ title, list, position }))).toEqual([
            { title: 'Modo foco com atalho de teclado', list: 'Ideias', position: 1 },
            { title: 'Exportar quadro em PDF', list: 'Ideias', position: 2 },
            { title: 'Revisar textos da página inicial', list: 'A fazer', position: 1 },
            { title: 'Criar etiquetas do time', list: 'A fazer', position: 2 },
            { title: 'Configurar backup do banco', list: 'A fazer', position: 3 },
            { title: 'Arrastar e soltar entre colunas', list: 'Em andamento', position: 1 },
            { title: 'Instalar o Taskon localmente', list: 'Concluído', position: 1 },
        ]);

        const byTitle = new Map(rows.map((row) => [row.title, row]));

        // Prazos em dias de calendário no fuso do app, mantendo a hora.
        expect(toAppIso(byTitle.get('Revisar textos da página inicial')?.dueAt)).toBe('2026-10-15T10:00:00-03:00');
        expect(toAppIso(byTitle.get('Configurar backup do banco')?.dueAt)).toBe('2026-10-13T10:00:00-03:00');
        expect(toAppIso(byTitle.get('Arrastar e soltar entre colunas')?.dueAt)).toBe('2026-10-14T10:00:00-03:00');
        expect(byTitle.get('Modo foco com atalho de teclado')?.dueAt).toBeNull();

        // Só o card da coluna de conclusão nasce concluído.
        expect(byTitle.get('Instalar o Taskon localmente')?.completedAt?.getTime()).toBe(now.getTime());
        expect(rows.filter((row) => row.completedAt !== null)).toHaveLength(1);

        expect(rows.every((row) => row.createdBy === user.id)).toBe(true);

        const ids = rows.map((row) => row.id);
        const members = await db.select().from(cardUser).where(inArray(cardUser.cardId, ids));

        expect(members).toHaveLength(7);
        expect(members.every((member) => member.userId === user.id)).toBe(true);

        const attached = await db
            .select({ card: cards.title, label: labels.name })
            .from(cardLabel)
            .innerJoin(cards, eq(cards.id, cardLabel.cardId))
            .innerJoin(labels, eq(labels.id, cardLabel.labelId))
            .where(eq(cards.boardId, board.id));

        const labelsOf = (title: string) =>
            attached
                .filter((row) => row.card === title)
                .map((row) => row.label)
                .sort();

        expect(attached).toHaveLength(10);
        expect(labelsOf('Exportar quadro em PDF')).toEqual(['Ideia', 'Melhoria']);
        expect(labelsOf('Configurar backup do banco')).toEqual(['Backend', 'Urgente']);
        expect(labelsOf('Arrastar e soltar entre colunas')).toEqual(['Backend', 'Design']);
        expect(labelsOf('Instalar o Taskon localmente')).toEqual(['Backend']);
    });

    it('põe a checklist e o comentário de exemplo no card do tour', async () => {
        const user = await createUser();
        const board = await buildDemoBoard(user);

        const [tour] = await db
            .select()
            .from(cards)
            .where(eq(cards.title, 'Arrastar e soltar entre colunas'));

        expect(tour?.boardId).toBe(board.id);

        const lists = await db.select().from(checklists).where(eq(checklists.cardId, tour!.id));

        expect(lists).toHaveLength(1);
        expect(lists[0]).toMatchObject({ title: 'Passo a passo', position: 1 });

        const items = await db
            .select({ content: checklistItems.content, isDone: checklistItems.isDone, position: checklistItems.position })
            .from(checklistItems)
            .where(eq(checklistItems.checklistId, lists[0]!.id))
            .orderBy(asc(checklistItems.position));

        expect(items).toEqual([
            { content: 'Arraste este card para outra coluna', isDone: true, position: 1 },
            { content: 'Reordene as colunas pelo cabeçalho', isDone: false, position: 2 },
            { content: 'Abra o card e escreva uma descrição', isDone: false, position: 3 },
        ]);

        const notes = await db.select().from(comments).where(eq(comments.cardId, tour!.id));

        expect(notes).toHaveLength(1);
        expect(notes[0]).toMatchObject({
            userId: user.id,
            body: 'Bem-vindo ao Taskon! Este é um comentário de exemplo — pode apagar.',
        });
    });

    it('registra a criação no feed em nome de quem é dono', async () => {
        const user = await createUser();
        const board = await buildDemoBoard(user);

        const feed = await db.select().from(activities).where(eq(activities.boardId, board.id));

        expect(feed).toHaveLength(1);
        expect(feed[0]).toMatchObject({
            userId: user.id,
            cardId: null,
            type: 'board.created',
            description: 'criou o quadro Meu primeiro quadro',
            properties: null,
        });
    });

    it('vira savepoint dentro de uma transação maior — e some junto com ela', async () => {
        const user = await createUser();

        await expect(
            db.transaction(async (tx) => {
                await buildDemoBoard(user, 'Rascunho', tx);

                throw new Error('desiste');
            }),
        ).rejects.toThrow('desiste');

        expect(await db.select().from(boards)).toHaveLength(0);
        expect(await db.select().from(cards)).toHaveLength(0);
    });
});
