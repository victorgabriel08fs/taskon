import { and, asc, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/server/db';
import { activities, boardLists, type BoardListRow, type BoardRow } from '@/server/db/schema';
import { createList, deleteList, reorderLists, updateList } from '@/server/services/lists';
import { expectHttpError } from './support/assertions';
import * as factory from './support/factories';

/**
 * Colunas do quadro — o BoardListTest do Laravel, mais a regra da coluna de
 * conclusão do CompletionTest.
 */

afterEach(() => {
    vi.useRealTimers();
});

async function listRow(list: Pick<BoardListRow, 'id'>) {
    const [row] = await db.select().from(boardLists).where(eq(boardLists.id, list.id));

    return row;
}

async function orderOf(board: Pick<BoardRow, 'id'>) {
    const rows = await db
        .select({ id: boardLists.id })
        .from(boardLists)
        .where(eq(boardLists.boardId, board.id))
        .orderBy(asc(boardLists.position));

    return rows.map((row) => row.id);
}

describe('criar coluna', () => {
    it('entra no fim do quadro, contando também as arquivadas', async () => {
        const owner = await factory.createUser();
        const board = await factory.createBoard(owner);
        await factory.createList(board, { position: 2 });
        await factory.createList(board, { position: 7.5, archivedAt: new Date() });

        const list = await createList(owner, board.id, { title: 'Revisão' });

        expect(list).toMatchObject({ boardId: board.id, title: 'Revisão', position: 8.5, isDone: false, cardLimit: null });
        expect(await db.$count(activities, eq(activities.boardId, board.id))).toBe(0);
    });

    it('é a primeira posição no quadro vazio', async () => {
        const owner = await factory.createUser();
        const board = await factory.createBoard(owner);

        expect((await createList(owner, board.id, { title: 'Primeira' })).position).toBe(1);
    });

    it('qualquer membro cria; quem é de fora não', async () => {
        const board = await factory.createBoard(await factory.createUser());
        const member = await factory.createUser();
        await factory.addMember(board, member);

        await createList(member, board.id, { title: 'Do membro' });

        await expectHttpError(createList(await factory.createUser(), board.id, { title: 'Intrusa' }), 403);
        await expectHttpError(createList(member, 999_999, { title: 'Sem quadro' }), 404);
        expect(await db.$count(boardLists, eq(boardLists.boardId, board.id))).toBe(1);
    });
});

describe('editar coluna', () => {
    it('muda só os campos enviados', async () => {
        const owner = await factory.createUser();
        const board = await factory.createBoard(owner);
        const list = await factory.createList(board, { title: 'Antes', cardLimit: 4 });

        await updateList(owner, list.id, { title: 'Depois' });

        expect(await listRow(list)).toMatchObject({ title: 'Depois', cardLimit: 4, isDone: false });

        await updateList(owner, list.id, { card_limit: 10 });

        expect(await listRow(list)).toMatchObject({ title: 'Depois', cardLimit: 10 });

        await updateList(owner, list.id, { card_limit: null });

        expect((await listRow(list))?.cardLimit).toBeNull();
    });

    it('marcar a coluna como concluída conclui quem já está nela', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-12T15:00:00Z'));

        const owner = await factory.createUser();
        const board = await factory.createBoard(owner);
        const todo = await factory.createList(board, { position: 1 });
        const other = await factory.createList(board, { position: 2 });

        const late = await factory.createCard(todo, { dueAt: new Date('2026-10-09T15:00:00Z') });
        const alreadyDone = await factory.createCard(todo, { completedAt: new Date('2026-10-01T12:00:00Z') });
        const archived = await factory.createCard(todo, { archivedAt: new Date('2026-10-05T12:00:00Z') });
        const elsewhere = await factory.createCard(other);

        await updateList(owner, todo.id, { is_done: true });

        expect((await listRow(todo))?.isDone).toBe(true);
        expect((await factory.fresh(late))?.completedAt?.toISOString()).toBe('2026-10-12T15:00:00.000Z');

        // Quem já estava concluído mantém a data; arquivado e coluna vizinha ficam como estavam.
        expect((await factory.fresh(alreadyDone))?.completedAt?.toISOString()).toBe('2026-10-01T12:00:00.000Z');
        expect((await factory.fresh(archived))?.completedAt).toBeNull();
        expect((await factory.fresh(elsewhere))?.completedAt).toBeNull();
    });

    it('desmarcar a coluna, ou marcar de novo a que já é de conclusão, não mexe nos cards', async () => {
        const owner = await factory.createUser();
        const board = await factory.createBoard(owner);
        const done = await factory.createList(board, { isDone: true });
        const finished = await factory.createCard(done, { completedAt: new Date('2026-10-01T12:00:00Z') });
        const stray = await factory.createCard(done);

        await updateList(owner, done.id, { is_done: true });

        expect((await factory.fresh(stray))?.completedAt).toBeNull();

        await updateList(owner, done.id, { is_done: false });

        expect((await listRow(done))?.isDone).toBe(false);
        expect((await factory.fresh(finished))?.completedAt?.toISOString()).toBe('2026-10-01T12:00:00.000Z');
    });

    it('lista inexistente é 404; quem é de fora leva 403', async () => {
        const board = await factory.createBoard(await factory.createUser());
        const list = await factory.createList(board, { title: 'Intocada' });
        const stranger = await factory.createUser();

        await expectHttpError(updateList(stranger, 999_999, { title: 'X' }), 404);
        await expectHttpError(updateList(stranger, list.id, { title: 'Invadida' }), 403);

        expect((await listRow(list))?.title).toBe('Intocada');
    });
});

describe('excluir coluna', () => {
    it('remove a coluna com os cards dela e registra no histórico', async () => {
        const owner = await factory.createUser();
        const board = await factory.createBoard(owner);
        const list = await factory.createList(board, { title: 'Backlog' });
        const card = await factory.createCard(list);

        await deleteList(owner, list.id);

        expect(await listRow(list)).toBeUndefined();
        expect(await factory.fresh(card)).toBeUndefined();

        const [entry] = await db
            .select()
            .from(activities)
            .where(and(eq(activities.boardId, board.id), eq(activities.type, 'list.deleted')));

        expect(entry).toMatchObject({ userId: owner.id, description: 'removeu a lista Backlog', cardId: null });
    });

    it('quem é de fora não exclui', async () => {
        const board = await factory.createBoard(await factory.createUser());
        const list = await factory.createList(board);

        await expectHttpError(deleteList(await factory.createUser(), list.id), 403);
        await expectHttpError(deleteList(await factory.createUser(), 999_999), 404);

        expect(await listRow(list)).toBeDefined();
    });
});

describe('reordenar colunas', () => {
    it('usa a ordem enviada pelo cliente', async () => {
        const owner = await factory.createUser();
        const board = await factory.createBoard(owner);
        const a = await factory.createList(board, { position: 1 });
        const b = await factory.createList(board, { position: 2 });
        const c = await factory.createList(board, { position: 3 });

        await reorderLists(owner, board.id, [c.id, a.id, b.id]);

        expect(await orderOf(board)).toEqual([c.id, a.id, b.id]);
        expect((await listRow(c))?.position).toBe(1);
        expect((await listRow(b))?.position).toBe(3);
    });

    it('ignora listas de outros quadros', async () => {
        const owner = await factory.createUser();
        const board = await factory.createBoard(owner);
        const mine = await factory.createList(board, { position: 1 });
        const foreign = await factory.createList(await factory.createBoard(await factory.createUser()), { position: 9 });

        await reorderLists(owner, board.id, [foreign.id, mine.id, 99_999_999_999, -3]);

        expect((await listRow(foreign))?.position).toBe(9);
        expect((await listRow(mine))?.position).toBe(2);
    });

    it('quem é de fora não reordena', async () => {
        const board = await factory.createBoard(await factory.createUser());
        const list = await factory.createList(board, { position: 1 });

        await expectHttpError(reorderLists(await factory.createUser(), board.id, [list.id]), 403);

        expect((await listRow(list))?.position).toBe(1);
    });
});
