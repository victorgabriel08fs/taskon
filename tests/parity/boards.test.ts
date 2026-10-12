import { and, asc, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Toast } from '@/types';
import { createBoard, deleteBoard, toggleFavorite, updateBoard } from '@/server/actions/boards';
import { deleteList, reorderLists } from '@/server/actions/lists';
import { db } from '@/server/db';
import { boardLists, boardUser, boards, labels, type BoardRow, type UserRow } from '@/server/db/schema';
import { loadBoardPage } from '@/server/queries/board';
import { loadBoardsIndex } from '@/server/queries/boards-index';
import { expectHttpError } from '../support/assertions';
import * as factory from '../support/factories';

/**
 * Paridade com tests/Feature/BoardTest.php e BoardListTest.php: as rotas
 * POST/PATCH/DELETE viram as Server Actions; GET /boards e /boards/{id}, os
 * loaders das páginas.
 */
const request = vi.hoisted(() => ({ user: null as UserRow | null, flashed: [] as Toast[] }));

vi.mock('@/server/auth/session', () => ({
    currentSession: async () => (request.user ? { user: request.user, session: { id: 'sessao-de-teste' } } : null),
}));
vi.mock('@/server/flash', () => ({
    flash: async (toast: Toast) => {
        request.flashed.push(toast);
    },
}));
vi.mock('next/cache', () => ({ refresh: vi.fn() }));

async function redirectOf(call: Promise<unknown>): Promise<string | null> {
    try {
        await call;
    } catch (error) {
        const digest = (error as { digest?: unknown }).digest;

        if (typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT')) return digest.split(';')[2] ?? null;

        throw error;
    }

    return null;
}

async function boardRow(id: number) {
    const [row] = await db.select().from(boards).where(eq(boards.id, id));

    return row;
}

async function favoriteOf(board: BoardRow, user: UserRow): Promise<boolean | undefined> {
    const [row] = await db
        .select({ isFavorite: boardUser.isFavorite })
        .from(boardUser)
        .where(and(eq(boardUser.boardId, board.id), eq(boardUser.userId, user.id)));

    return row?.isFavorite;
}

beforeEach(() => {
    request.user = null;
    request.flashed.length = 0;
});

afterEach(() => {
    vi.useRealTimers();
});

describe('BoardTest', () => {
    it('test_the_board_list_shows_only_boards_the_user_belongs_to', async () => {
        const user = await factory.createUser();
        const mine = await factory.createBoard(user, { title: 'Meu quadro' });
        await factory.createBoard(await factory.createUser(), { title: 'Quadro de outra pessoa' });

        const { boards: list } = await loadBoardsIndex(user);

        expect(list).toHaveLength(1);
        expect(list[0]!.id).toBe(mine.id);
    });

    it('test_creating_a_board_seeds_lists_and_labels', async () => {
        const user = await factory.createUser();

        request.user = user;

        const target = await redirectOf(createBoard({ title: 'Novo quadro', background: 'ocean' }));

        const [board] = await db.select().from(boards).where(eq(boards.title, 'Novo quadro'));

        expect(board).toBeDefined();
        expect(target).toBe(`/boards/${board!.id}`);
        expect(await db.$count(boardLists, eq(boardLists.boardId, board!.id))).toBe(3);
        expect(await db.$count(labels, eq(labels.boardId, board!.id))).toBe(4);

        const [pivot] = await db
            .select({ role: boardUser.role })
            .from(boardUser)
            .where(and(eq(boardUser.boardId, board!.id), eq(boardUser.userId, user.id)));

        expect(pivot?.role).toBe('owner');
    });

    it('test_non_members_cannot_open_a_board', async () => {
        const board = await factory.createBoard(await factory.createUser());
        const stranger = await factory.createUser();

        await expectHttpError(loadBoardPage(stranger, board.id), 403);
    });

    it('test_members_can_open_a_board', async () => {
        const board = await factory.createBoard(await factory.createUser());
        const member = await factory.createUser();
        await factory.addMember(board, member, 'member');

        expect((await loadBoardPage(member, board.id)).board.id).toBe(board.id);
    });

    it('test_plain_members_cannot_change_board_settings', async () => {
        const board = await factory.createBoard(await factory.createUser(), { background: 'aurora' });
        const member = await factory.createUser();
        await factory.addMember(board, member, 'member');

        request.user = member;

        expect(await updateBoard({ boardId: board.id, background: 'ember' })).toMatchObject({ ok: false, status: 403 });
        expect((await boardRow(board.id))?.background).toBe('aurora');
    });

    it('test_only_the_owner_can_delete_a_board', async () => {
        const owner = await factory.createUser();
        const board = await factory.createBoard(owner);
        const admin = await factory.createUser();
        await factory.addMember(board, admin, 'admin');

        request.user = admin;
        expect(await deleteBoard({ boardId: board.id })).toMatchObject({ ok: false, status: 403 });

        request.user = owner;
        expect(await redirectOf(deleteBoard({ boardId: board.id }))).toBe('/boards');
        expect(await boardRow(board.id)).toBeUndefined();
    });

    it('test_favorite_toggles_per_user', async () => {
        const owner = await factory.createUser();
        const board = await factory.createBoard(owner);

        request.user = owner;

        expect((await toggleFavorite({ boardId: board.id })).ok).toBe(true);
        expect(await favoriteOf(board, owner)).toBe(true);

        await toggleFavorite({ boardId: board.id });
        expect(await favoriteOf(board, owner)).toBe(false);
    });
});

describe('BoardListTest', () => {
    async function orderOf(board: BoardRow): Promise<number[]> {
        // `$board->lists()->pluck('id')`: a relação ordena por position.
        const rows = await db
            .select({ id: boardLists.id })
            .from(boardLists)
            .where(eq(boardLists.boardId, board.id))
            .orderBy(asc(boardLists.position));

        return rows.map((row) => row.id);
    }

    it('test_reordering_lists_uses_the_order_sent_by_the_client', async () => {
        const owner = await factory.createUser();
        const board = await factory.createBoard(owner);
        const a = await factory.createList(board, { position: 1 });
        const b = await factory.createList(board, { position: 2 });
        const c = await factory.createList(board, { position: 3 });

        request.user = owner;

        expect((await reorderLists({ boardId: board.id, ordered_ids: [c.id, a.id, b.id] })).ok).toBe(true);

        expect(await orderOf(board)).toEqual([c.id, a.id, b.id]);
    });

    it('test_reorder_ignores_lists_from_other_boards', async () => {
        const owner = await factory.createUser();
        const board = await factory.createBoard(owner);
        const mine = await factory.createList(board, { position: 1 });
        const foreign = await factory.createList(await factory.createBoard(await factory.createUser()), { position: 9 });

        request.user = owner;

        await reorderLists({ boardId: board.id, ordered_ids: [foreign.id, mine.id] });

        const [foreignRow] = await db.select().from(boardLists).where(eq(boardLists.id, foreign.id));
        const [mineRow] = await db.select().from(boardLists).where(eq(boardLists.id, mine.id));

        expect(foreignRow?.position).toBeCloseTo(9.0, 3);
        expect(mineRow?.position).toBeCloseTo(2.0, 3);
    });

    it('test_deleting_a_list_removes_its_cards', async () => {
        const owner = await factory.createUser();
        const board = await factory.createBoard(owner);
        const list = await factory.createList(board);
        const card = await factory.createCard(list);

        request.user = owner;

        expect((await deleteList({ listId: list.id })).ok).toBe(true);

        expect(await db.select().from(boardLists).where(eq(boardLists.id, list.id))).toHaveLength(0);
        expect(await factory.fresh(card)).toBeUndefined();
    });
});
