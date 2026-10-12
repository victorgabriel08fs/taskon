import { and, asc, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Toast } from '@/types';
import { createBoard as createBoardAction } from '@/server/actions/boards';
import {
    createCard,
    deleteCard,
    moveCard,
    toggleCardLabel,
    updateCard,
} from '@/server/actions/cards';
import { loadExportDetails } from '@/server/actions/export';
import { updateList } from '@/server/actions/lists';
import { db } from '@/server/db';
import {
    activities,
    boardLists,
    boards,
    cardLabel,
    cardUser,
    cards,
    checklistItems,
    checklists,
    comments,
    type BoardListRow,
    type BoardRow,
    type CardRow,
    type UserRow,
} from '@/server/db/schema';
import { loadBoardPage } from '@/server/queries/board';
import { loadDashboard } from '@/server/queries/dashboard';
import { taskDigestFor } from '@/server/services/task-digest';
import { addAppDays, endOfAppDay, startOfAppDay } from '@/lib/timezone';
import * as factory from '../support/factories';

/**
 * Paridade com tests/Feature/CardTest.php, CompletionTest.php e
 * CardExportTest.php — as rotas viram as Server Actions (validação, permissão,
 * toast e redirect de verdade); só a sessão, o flash e o refresh() são dublês.
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

let board: BoardRow;
let user: UserRow;
let todo: BoardListRow;

beforeEach(async () => {
    user = await factory.createUser();
    board = await factory.createBoard(user);
    todo = await factory.createList(board, { position: 1 });

    request.user = user;
    request.flashed.length = 0;
});

afterEach(() => {
    vi.useRealTimers();
});

describe('CardTest', () => {
    let doing: BoardListRow;

    beforeEach(async () => {
        doing = await factory.createList(board, { position: 2 });
    });

    async function cardIdsIn(list: BoardListRow): Promise<number[]> {
        // `$this->doing->cards()->pluck('id')`: a relação ordena por position.
        const rows = await db
            .select({ id: cards.id })
            .from(cards)
            .where(eq(cards.boardListId, list.id))
            .orderBy(asc(cards.position));

        return rows.map((row) => row.id);
    }

    it('test_a_card_is_appended_to_the_end_of_the_list', async () => {
        await factory.createCard(todo, { position: 1 });

        expect((await createCard({ listId: todo.id, title: 'Segundo card' })).ok).toBe(true);

        const [card] = await db.select().from(cards).where(eq(cards.title, 'Segundo card'));

        expect(card?.boardListId).toBe(todo.id);
        expect(card?.boardId).toBe(board.id);
        expect(card?.position).toBeCloseTo(2.0, 3);
    });

    it('test_whoever_creates_the_card_is_already_a_member_of_it', async () => {
        expect((await createCard({ listId: todo.id, title: 'Nasce comigo' })).ok).toBe(true);

        const [card] = await db.select().from(cards).where(eq(cards.title, 'Nasce comigo'));
        const members = await db.select({ userId: cardUser.userId }).from(cardUser).where(eq(cardUser.cardId, card!.id));

        expect(members.map((row) => row.userId)).toEqual([user.id]);
    });

    it('test_moving_a_card_to_another_list_rewrites_the_order', async () => {
        const first = await factory.createCard(doing, { position: 1 });
        const second = await factory.createCard(doing, { position: 2 });
        const moved = await factory.createCard(todo, { position: 1 });

        expect(
            (await moveCard({ cardId: moved.id, board_list_id: doing.id, ordered_ids: [first.id, moved.id, second.id] })).ok,
        ).toBe(true);

        expect((await factory.fresh(moved))?.boardListId).toBe(doing.id);
        expect(await cardIdsIn(doing)).toEqual([first.id, moved.id, second.id]);
    });

    it('test_a_card_cannot_be_moved_into_a_list_from_another_board', async () => {
        const foreignList = await factory.createList(await factory.createBoard(await factory.createUser()));
        const card = await factory.createCard(todo, { position: 1 });

        const result = await moveCard({ cardId: card.id, board_list_id: foreignList.id, ordered_ids: [card.id] });

        expect(result).toMatchObject({ ok: false, status: 422 });
        expect(result.ok ? null : result.errors?.board_list_id).toBeTruthy();
        expect((await factory.fresh(card))?.boardListId).toBe(todo.id);
    });

    it('test_completing_a_card_records_activity', async () => {
        const card = await factory.createCard(todo, { position: 1 });

        expect((await updateCard({ cardId: card.id, is_completed: true })).ok).toBe(true);

        expect((await factory.fresh(card))?.completedAt).not.toBeNull();

        const rows = await db
            .select()
            .from(activities)
            .where(and(eq(activities.cardId, card.id), eq(activities.type, 'card.completed')));

        expect(rows).toHaveLength(1);
    });

    it('test_labels_are_toggled_and_scoped_to_the_board', async () => {
        const card = await factory.createCard(todo, { position: 1 });
        const label = await factory.createLabel(board, { name: 'Urgente', color: 'rose' });
        const foreignLabel = await factory.createLabel(await factory.createBoard(await factory.createUser()), {
            name: 'X',
            color: 'blue',
        });

        const attached = async () =>
            (await db.select().from(cardLabel).where(and(eq(cardLabel.cardId, card.id), eq(cardLabel.labelId, label.id))))
                .length > 0;

        await toggleCardLabel({ cardId: card.id, labelId: label.id });
        expect(await attached()).toBe(true);

        await toggleCardLabel({ cardId: card.id, labelId: label.id });
        expect(await attached()).toBe(false);

        expect(await toggleCardLabel({ cardId: card.id, labelId: foreignLabel.id })).toMatchObject({
            ok: false,
            status: 404,
        });
    });

    it('test_deleting_a_card_redirects_to_the_board_not_back_to_the_card_url', async () => {
        const card = await factory.createCard(todo, { position: 1 });

        expect(await redirectOf(deleteCard({ cardId: card.id }))).toBe(`/boards/${board.id}`);
        expect(await factory.fresh(card)).toBeUndefined();
    });

    it('test_outsiders_cannot_touch_cards', async () => {
        const card = await factory.createCard(todo, { position: 1 });

        request.user = await factory.createUser();

        expect(await updateCard({ cardId: card.id, title: 'Hackeado' })).toMatchObject({ ok: false, status: 403 });
        expect((await factory.fresh(card))?.title).not.toBe('Hackeado');
    });

    it('test_the_board_payload_carries_checklist_and_comment_counters', async () => {
        const card = await factory.createCard(todo, { position: 1 });
        const [checklist] = await db.insert(checklists).values({ cardId: card.id, title: 'Passos', position: 1 }).returning();

        await db.insert(checklistItems).values([
            { checklistId: checklist!.id, content: 'a', isDone: true, position: 1 },
            { checklistId: checklist!.id, content: 'b', isDone: false, position: 2 },
        ]);
        await db.insert(comments).values({ cardId: card.id, userId: user.id, body: 'oi' });

        const { board: payload } = await loadBoardPage(user, board.id);

        expect(payload.lists[0]!.cards[0]).toMatchObject({ checklist_total: 2, checklist_done: 1, comments_count: 1 });
    });
});

describe('CompletionTest', () => {
    let done: BoardListRow;

    beforeEach(async () => {
        done = await factory.createList(board, { position: 2, isDone: true });
    });

    async function move(card: CardRow, to: BoardListRow): Promise<void> {
        expect((await moveCard({ cardId: card.id, board_list_id: to.id, ordered_ids: [card.id] })).ok).toBe(true);
    }

    it('test_dragging_into_the_done_column_completes_the_card', async () => {
        const card = await factory.createCard(todo);

        await move(card, done);

        expect((await factory.fresh(card))?.completedAt).not.toBeNull();
    });

    it('test_dragging_out_of_the_done_column_reopens_the_card', async () => {
        const card = await factory.createCard(done, { completedAt: new Date(Date.now() - 3_600_000) });

        await move(card, todo);

        expect((await factory.fresh(card))?.completedAt).toBeNull();
    });

    it('test_moving_between_ordinary_columns_does_not_undo_a_manual_completion', async () => {
        const other = await factory.createList(board, { position: 3 });
        const card = await factory.createCard(todo);

        await updateCard({ cardId: card.id, is_completed: true });
        await move(card, other);

        expect((await factory.fresh(card))?.completedAt, 'arrastar não pode desfazer a decisão manual').not.toBeNull();
    });

    it('test_marking_a_column_as_done_completes_who_is_already_inside', async () => {
        const card = await factory.createCard(todo, { dueAt: addAppDays(new Date(), -3) });

        expect((await updateList({ listId: todo.id, is_done: true })).ok).toBe(true);

        expect((await factory.fresh(card))?.completedAt).not.toBeNull();
    });

    it('test_a_new_board_gets_a_done_column', async () => {
        request.user = await factory.createUser();

        await redirectOf(createBoardAction({ title: 'Novo', background: 'ocean' }));

        const [created] = await db.select().from(boards).where(eq(boards.title, 'Novo'));
        const doneLists = await db
            .select({ title: boardLists.title })
            .from(boardLists)
            .where(and(eq(boardLists.boardId, created!.id), eq(boardLists.isDone, true)));

        expect(doneLists.map((list) => list.title)).toEqual(['Concluído']);
    });

    describe('a fronteira do dia, a qualquer hora', () => {
        // O legado usa o relógio real: o teste tem de passar a qualquer hora
        // em que a suíte rode. Aqui a mesma conta, em horários espalhados pelo
        // dia de São Paulo (inclusive perto da meia-noite).
        const mornings = ['2026-10-12T03:00:00Z', '2026-10-12T03:30:00Z', '2026-10-12T13:00:00Z', '2026-10-13T02:30:00Z'];

        for (const iso of mornings) {
            it(`test_a_card_due_later_today_is_not_overdue (agora = ${iso})`, async () => {
                vi.useFakeTimers({ toFake: ['Date'] });
                vi.setSystemTime(new Date(iso));

                const card = await factory.createCard(todo, { dueAt: new Date(startOfAppDay(new Date()).getTime() + 3_600_000) });
                await factory.assign(card, user);

                vi.setSystemTime(new Date(startOfAppDay(new Date()).getTime() + 15 * 3_600_000));

                const digest = await taskDigestFor(user);

                expect(digest.overdue).toHaveLength(0);
                expect(digest.today.map((item) => item.id)).toEqual([card.id]);
            });

            it(`test_a_card_from_yesterday_is_overdue (agora = ${iso})`, async () => {
                vi.useFakeTimers({ toFake: ['Date'] });
                vi.setSystemTime(new Date(iso));

                const card = await factory.createCard(todo, { dueAt: endOfAppDay(addAppDays(new Date(), -1)) });
                await factory.assign(card, user);

                const digest = await taskDigestFor(user);

                expect(digest.overdue.map((item) => item.id)).toEqual([card.id]);
            });

            it(`test_the_dashboard_agrees_with_the_digest (agora = ${iso})`, async () => {
                vi.useFakeTimers({ toFake: ['Date'] });
                vi.setSystemTime(new Date(iso));

                const today = await factory.createCard(todo, { dueAt: new Date(startOfAppDay(new Date()).getTime() + 3_600_000) });
                await factory.assign(today, user);

                const late = await factory.createCard(todo, { dueAt: addAppDays(new Date(), -2) });
                await factory.assign(late, user);

                const finished = await factory.createCard(done, {
                    dueAt: addAppDays(new Date(), -5),
                    completedAt: addAppDays(new Date(), -1),
                });
                await factory.assign(finished, user);

                vi.setSystemTime(new Date(startOfAppDay(new Date()).getTime() + 15 * 3_600_000));

                const data = await loadDashboard(user);

                expect(data.stats.overdue).toBe(1);
                expect(data.stats.today).toBe(1);
                expect(data.breakdown.overdue).toBe(1);
                expect(data.breakdown.today).toBe(1);
                expect(data.boards[0]!.overdue).toBe(1);
            });
        }
    });
});

describe('CardExportTest', () => {
    it('test_the_export_detail_stays_out_of_the_first_paint', async () => {
        await factory.createCard(todo, { position: 1 });

        const page = await loadBoardPage(user, board.id);

        expect(page).not.toHaveProperty('exportDetails');
        expect(Object.keys(page).sort()).toEqual(['autoArchive', 'backgrounds', 'board', 'colors']);
    });

    it('test_the_export_detail_carries_description_checklists_and_comments', async () => {
        const card = await factory.createCard(todo, { position: 1, description: 'Precisa suportar Google.' });
        const [checklist] = await db.insert(checklists).values({ cardId: card.id, title: 'Backend', position: 1 }).returning();

        await db.insert(checklistItems).values([
            { checklistId: checklist!.id, content: 'criar rota', isDone: true, position: 1 },
            { checklistId: checklist!.id, content: 'validar token', isDone: false, position: 2 },
        ]);
        await db.insert(comments).values({ cardId: card.id, userId: user.id, body: 'Vamos de Socialite.' });

        const result = await loadExportDetails({ boardId: board.id });

        expect(result.ok).toBe(true);

        const detail = result.ok ? result.data[0] : undefined;

        expect(detail?.id).toBe(card.id);
        expect(detail?.description).toBe('Precisa suportar Google.');
        expect(detail?.checklists[0]?.title).toBe('Backend');
        expect(detail?.checklists[0]?.items[0]).toMatchObject({ content: 'criar rota', is_done: true });
        expect(detail?.comments[0]).toMatchObject({ author: user.name, body: 'Vamos de Socialite.' });
        expect(Object.keys(detail!)).toEqual(['id', 'description', 'checklists', 'comments']);
    });

    it('test_archived_cards_stay_out_of_the_export', async () => {
        await factory.createCard(todo, { position: 1, title: 'Viva' });
        await factory.createCard(todo, { position: 2, title: 'Arquivada', archivedAt: new Date() });

        const result = await loadExportDetails({ boardId: board.id });

        expect(result.ok && result.data).toHaveLength(1);
    });

    it('test_someone_outside_the_board_gets_nothing', async () => {
        await factory.createCard(todo, { position: 1 });

        request.user = await factory.createUser();

        expect(await loadExportDetails({ boardId: board.id })).toMatchObject({ ok: false, status: 403 });
    });
});
