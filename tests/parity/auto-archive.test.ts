import { and, eq } from 'drizzle-orm';
import { refresh } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Toast } from '@/types';
import { GET as archiveDoneCardsCron } from '@/app/api/cron/archive-done-cards/route';
import {
    archiveCard,
    archiveDoneCards,
    loadArchivedCards,
    restoreCard,
} from '@/server/actions/archive';
import { updateBoard } from '@/server/actions/boards';
import { db } from '@/server/db';
import { activities, boards, type BoardListRow, type BoardRow, type UserRow } from '@/server/db/schema';
import { loadBoardPage } from '@/server/queries/board';
import { loadBoardsIndex } from '@/server/queries/boards-index';
import { loadDashboard } from '@/server/queries/dashboard';
import { addMember, assign, createBoard, createCard, createList, createUser, fresh } from '../support/factories';

/**
 * Paridade com tests/Feature/AutoArchiveTest.php, um teste por teste, na
 * camada mais próxima do HTTP que existe aqui:
 *
 *  - `$this->artisan('taskon:archive-done-cards', …)->assertSuccessful()` →
 *    a rota do cron (GET /api/cron/archive-done-cards), que é quem roda o
 *    comando agora; `--board`/`--dry-run` viram `?board=`/`?dry-run=1`;
 *  - `post/patch(...)` → a Server Action correspondente;
 *  - `get('/boards/1')`, `get('/dashboard')`, `get('/boards')` → o loader que a
 *    página chama.
 */
const request = vi.hoisted(() => ({ user: null as UserRow | null, flashed: [] as Toast[] }));

vi.mock('@/server/auth/session', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/server/auth/session')>()),
    currentSession: async () => (request.user ? { user: request.user, session: { id: 'sessao-de-teste' } } : null),
}));
vi.mock('@/server/flash', () => ({
    flash: async (toast: Toast) => {
        request.flashed.push(toast);
    },
}));
vi.mock('next/cache', () => ({ refresh: vi.fn() }));

// O legado roda com o relógio de verdade; PARITY_NOW permite repetir a
// suíte em outros horários (ex.: 23:59 em São Paulo = 02:59Z do dia seguinte).
const NOW = new Date(process.env.PARITY_NOW ?? '2026-10-12T15:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

let board: BoardRow;
let user: UserRow;
let todo: BoardListRow;
let done: BoardListRow;

beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    user = await createUser();
    board = await createBoard(user, { autoArchiveDoneAfterDays: 7 });
    todo = await createList(board, { title: 'A fazer', position: 1 });
    done = await createList(board, { title: 'Concluído', position: 2, isDone: true });

    request.user = user;
    request.flashed.length = 0;
    vi.mocked(refresh).mockClear();
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

/** `$this->artisan('taskon:archive-done-cards', $options)->assertSuccessful()`. */
async function sweep(query = ''): Promise<void> {
    const response = await archiveDoneCardsCron(new Request(`http://taskon.test/api/cron/archive-done-cards${query}`));

    expect(response.status).toBe(200);
}

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

async function boardRow(): Promise<BoardRow> {
    const [row] = await db.select().from(boards).where(eq(boards.id, board.id));

    return row!;
}

describe('a varredura', () => {
    it('test_it_archives_what_passed_the_deadline_and_leaves_the_rest', async () => {
        const velho = await createCard(done, { completedAt: daysAgo(8) });
        const novo = await createCard(done, { completedAt: daysAgo(2) });

        await sweep();

        expect((await fresh(velho))?.archivedAt).not.toBeNull();
        expect((await fresh(novo))?.archivedAt, 'dentro do prazo o card fica').toBeNull();
    });

    it('test_an_open_card_is_never_archived_no_matter_how_old', async () => {
        const esquecido = await createCard(todo, { createdAt: daysAgo(365), dueAt: daysAgo(182) });

        await sweep();

        expect((await fresh(esquecido))?.archivedAt).toBeNull();
    });

    it('test_a_board_without_a_deadline_is_never_touched', async () => {
        await db.update(boards).set({ autoArchiveDoneAfterDays: null }).where(eq(boards.id, board.id));
        const card = await createCard(done, { completedAt: daysAgo(365) });

        await sweep();

        expect((await fresh(card))?.archivedAt).toBeNull();
    });

    it('test_the_dry_run_archives_nothing', async () => {
        const card = await createCard(done, { completedAt: daysAgo(30) });

        await sweep('?dry-run=1');

        expect((await fresh(card))?.archivedAt).toBeNull();
    });

    it('test_the_board_option_scopes_the_sweep', async () => {
        const outro = await createBoard(await createUser(), { autoArchiveDoneAfterDays: 1 });
        const lista = await createList(outro);
        const deFora = await createCard(lista, { completedAt: daysAgo(30) });
        const daqui = await createCard(done, { completedAt: daysAgo(30) });

        await sweep(`?board=${board.id}`);

        expect((await fresh(daqui))?.archivedAt).not.toBeNull();
        expect((await fresh(deFora))?.archivedAt).toBeNull();
    });

    it('test_the_sweep_leaves_one_line_in_the_history_not_one_per_card', async () => {
        for (let index = 0; index < 3; index++) await createCard(done, { completedAt: daysAgo(10) });

        await sweep();

        const rows = await db
            .select()
            .from(activities)
            .where(and(eq(activities.boardId, board.id), eq(activities.type, 'cards.auto_archived')));

        expect(rows).toHaveLength(1);
    });
});

describe('o quadro', () => {
    it('test_an_archived_card_leaves_the_board_payload', async () => {
        await createCard(done, { completedAt: daysAgo(10) });
        await createCard(todo);

        await sweep();

        const { board: payload } = await loadBoardPage(user, board.id);

        expect(payload.lists[0]!.cards).toHaveLength(1);
        expect(payload.lists[1]!.cards).toHaveLength(0);
        expect(payload.archived_count).toBe(1);
        expect(payload.auto_archive_days).toBe(7);
    });

    it('test_the_archived_drawer_is_only_loaded_when_asked_for', async () => {
        await createCard(done, { completedAt: daysAgo(10) });
        await sweep();

        // Primeira pintura: a gaveta não vem com o quadro.
        expect(await loadBoardPage(user, board.id)).not.toHaveProperty('archivedCards');

        // O pedido parcial: a action de leitura.
        const drawer = await loadArchivedCards({ boardId: board.id });

        expect(drawer.ok).toBe(true);
        expect(drawer.ok && drawer.data).toHaveLength(1);
        expect(drawer.ok && drawer.data[0]?.list_title).toBe('Concluído');
    });
});

describe('histórico e painel', () => {
    it('test_archiving_does_not_undo_the_progress_of_the_board', async () => {
        for (let index = 0; index < 10; index++) await createCard(done, { completedAt: daysAgo(20) });

        expect((await loadDashboard(user)).boards[0]).toMatchObject({ total: 10, done: 10 });

        await sweep();

        expect((await loadDashboard(user)).boards[0]).toMatchObject({ total: 10, done: 10 });

        const index = await loadBoardsIndex(user);

        expect(index.boards[0]).toMatchObject({ cards_count: 10, done_count: 10 });
    });

    it('test_an_archived_completion_still_counts_in_the_week', async () => {
        await db.update(boards).set({ autoArchiveDoneAfterDays: 1 }).where(eq(boards.id, board.id));

        const card = await createCard(done, { completedAt: daysAgo(3) });
        await assign(card, user);

        await sweep();

        expect((await fresh(card))?.archivedAt).not.toBeNull();

        const data = await loadDashboard(user);

        expect(data.stats.completed_week).toBe(1);
        expect(data.trend.reduce((sum, point) => sum + point.completed, 0)).toBe(1);
    });

    it('test_an_archived_card_is_not_an_open_task_anymore', async () => {
        const card = await createCard(done, { completedAt: daysAgo(10), dueAt: daysAgo(20) });
        await assign(card, user);

        await sweep();

        const data = await loadDashboard(user);

        expect(data.stats.overdue).toBe(0);
        expect(data.stats.open).toBe(0);
        expect(data.boards[0]!.overdue).toBe(0);
        expect(data.deadlines).toHaveLength(0);
    });
});

describe('arquivar na mão', () => {
    it('test_a_card_can_be_archived_by_hand_without_being_done', async () => {
        const card = await createCard(todo);

        // Redirect para o quadro, não back().
        expect(await redirectOf(archiveCard({ cardId: card.id }))).toBe(`/boards/${board.id}`);

        expect((await fresh(card))?.archivedAt).not.toBeNull();
        expect((await fresh(card))?.completedAt).toBeNull();
    });

    it('test_archive_now_runs_the_same_sweep', async () => {
        const velho = await createCard(done, { completedAt: daysAgo(8) });
        const novo = await createCard(done, { completedAt: daysAgo(2) });

        expect((await archiveDoneCards({ boardId: board.id })).ok).toBe(true);

        expect((await fresh(velho))?.archivedAt).not.toBeNull();
        expect((await fresh(novo))?.archivedAt).toBeNull();
    });

    it('test_archive_now_does_nothing_without_a_deadline', async () => {
        await db.update(boards).set({ autoArchiveDoneAfterDays: null }).where(eq(boards.id, board.id));
        const card = await createCard(done, { completedAt: daysAgo(365) });

        expect((await archiveDoneCards({ boardId: board.id })).ok).toBe(true);

        expect((await fresh(card))?.archivedAt).toBeNull();
    });
});

describe('restaurar', () => {
    it('test_restoring_reopens_the_card_and_takes_it_out_of_the_done_column', async () => {
        const card = await createCard(done, { completedAt: daysAgo(10), archivedAt: NOW });

        expect((await restoreCard({ cardId: card.id })).ok).toBe(true);

        const restored = await fresh(card);

        expect(restored?.archivedAt).toBeNull();
        expect(restored?.completedAt, 'restaurar reabre o card').toBeNull();
        expect(restored?.boardListId, 'não volta para a coluna dos prontos').toBe(todo.id);
    });

    it('test_restoring_from_an_ordinary_column_keeps_the_card_where_it_was', async () => {
        const card = await createCard(todo, { archivedAt: NOW });

        expect((await restoreCard({ cardId: card.id })).ok).toBe(true);

        expect((await fresh(card))?.boardListId).toBe(todo.id);
    });

    it('test_the_restored_card_goes_to_the_end_of_the_queue', async () => {
        await createCard(todo, { position: 1 });
        await createCard(todo, { position: 2 });
        const card = await createCard(done, { completedAt: daysAgo(10), archivedAt: NOW });

        await restoreCard({ cardId: card.id });

        expect((await fresh(card))?.position).toBe(3);
    });

    it('test_restoring_gives_the_drawer_back_in_the_same_round_trip', async () => {
        const card = await createCard(done, { completedAt: daysAgo(10), archivedAt: NOW });
        const vizinho = await createCard(done, { completedAt: daysAgo(10), archivedAt: NOW });

        const result = await restoreCard({ cardId: card.id });

        expect(result.ok).toBe(true);
        expect(result.ok && result.data.map((archived) => archived.id)).toEqual([vizinho.id]);

        // `props.board.archived_count`: o quadro volta re-renderizado na mesma
        // resposta (refresh), e o loader dele conta só o vizinho.
        expect(refresh).toHaveBeenCalled();
        expect((await loadBoardPage(user, board.id)).board.archived_count).toBe(1);
    });

    it('test_restoring_a_card_that_is_not_archived_is_a_404', async () => {
        const card = await createCard(todo);

        expect(await restoreCard({ cardId: card.id })).toMatchObject({ ok: false, status: 404 });
    });
});

describe('o ajuste', () => {
    it('test_the_deadline_only_accepts_the_configured_options', async () => {
        const result = await updateBoard({ boardId: board.id, auto_archive_done_after_days: 5 });

        expect(result).toMatchObject({ ok: false, status: 422 });
        expect(result.ok ? null : result.errors?.auto_archive_done_after_days).toBeTruthy();

        expect((await boardRow()).autoArchiveDoneAfterDays).toBe(7);
    });

    it('test_null_turns_the_deadline_off_and_the_history_records_it', async () => {
        expect((await updateBoard({ boardId: board.id, auto_archive_done_after_days: null })).ok).toBe(true);

        expect((await boardRow()).autoArchiveDoneAfterDays).toBeNull();

        const rows = await db
            .select()
            .from(activities)
            .where(and(eq(activities.boardId, board.id), eq(activities.type, 'board.auto_archive')));

        expect(rows).toHaveLength(1);
    });

    it('test_a_plain_member_cannot_change_the_deadline', async () => {
        const member = await createUser();

        await addMember(board, member, 'member');
        request.user = member;

        expect(await updateBoard({ boardId: board.id, auto_archive_done_after_days: 30 })).toMatchObject({
            ok: false,
            status: 403,
        });
        expect(await archiveDoneCards({ boardId: board.id })).toMatchObject({ ok: false, status: 403 });

        expect((await boardRow()).autoArchiveDoneAfterDays).toBe(7);
    });

    it('test_outsiders_cannot_archive_or_restore', async () => {
        const card = await createCard(done, { completedAt: daysAgo(10) });

        request.user = await createUser();

        expect(await archiveCard({ cardId: card.id })).toMatchObject({ ok: false, status: 403 });
        expect(await restoreCard({ cardId: card.id })).toMatchObject({ ok: false, status: 403 });
    });
});
