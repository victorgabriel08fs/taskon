import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as dailyDigestCron } from '@/app/api/cron/daily-digest/route';
import { addAppDays, endOfAppDay, toAppIso } from '@/lib/timezone';
import { sendTestDigest, updateDigestPreference } from '@/server/actions/notifications';
import { db } from '@/server/db';
import { users, type BoardRow, type UserRow, type cards } from '@/server/db/schema';
import { sentMail } from '@/server/mail/mailer';
import { loadDashboard, loadDashboardActivity } from '@/server/queries/dashboard';
import { notificationSettingsFor } from '@/server/services/daily-digest';
import { isDigestEmpty, taskDigestFor } from '@/server/services/task-digest';
import { addMember, assign, createBoard, createCard, createList, createUser } from '../support/factories';

/**
 * Paridade com tests/Feature/DashboardTest.php e DailyDigestTest.php.
 *
 * O legado roda com o relógio de verdade: o teste tem de passar a qualquer
 * hora do dia. Aqui cada caso que depende do relógio roda em horários
 * espalhados pelo dia de São Paulo — inclusive depois das 21:00, quando o dia
 * em UTC já virou e o de São Paulo ainda não.
 *
 * `$this->artisan('taskon:daily-digest')` → a rota do cron; `Mail::fake()` →
 * a caixa de saída do mailer `array` (`sentMail`).
 */
const request = vi.hoisted(() => ({ user: null as UserRow | null }));

vi.mock('@/server/auth/session', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/server/auth/session')>()),
    currentSession: async () => (request.user ? { user: request.user, session: { id: 'sessao-de-teste' } } : null),
}));
vi.mock('next/cache', () => ({ refresh: vi.fn() }));

/**
 * Horários de "agora" (UTC) — 00:30, 09:00, 15:00, 21:30 e 23:59 em São Paulo.
 * PARITY_CLOCKS (separados por vírgula) troca a lista, para repetir a suíte
 * em viradas de mês e de ano.
 */
const CLOCKS = process.env.PARITY_CLOCKS?.split(',') ?? [
    '2026-10-12T03:30:00Z',
    '2026-10-12T12:00:00Z',
    '2026-10-12T18:00:00Z',
    '2026-10-13T00:30:00Z',
    '2026-10-13T02:59:00Z',
];

function freeze(iso: string): void {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(iso));
}

beforeEach(() => {
    request.user = null;
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

async function cardIn(board: BoardRow, overrides: Partial<typeof cards.$inferInsert> = {}, assignee?: UserRow) {
    const list = await createList(board);
    const card = await createCard(list, overrides);

    if (assignee) await assign(card, assignee);

    return card;
}

/** `assignedCard()` do DailyDigestTest: card atribuído, num quadro de que a pessoa é dona. */
async function assignedCard(user: UserRow, overrides: Partial<typeof cards.$inferInsert> = {}, board?: BoardRow) {
    return cardIn(board ?? (await createBoard(user)), overrides, user);
}

async function reload(user: UserRow): Promise<UserRow> {
    const [row] = await db.select().from(users).where(eq(users.id, user.id));

    return row!;
}

/** `$this->artisan('taskon:daily-digest', $options)->assertSuccessful()`. */
async function digestCommand(query = ''): Promise<void> {
    const response = await dailyDigestCron(new Request(`http://taskon.test/api/cron/daily-digest${query}`));

    expect(response.status).toBe(200);
}

describe('DashboardTest', () => {
    for (const clock of CLOCKS) {
        describe(`agora = ${clock}`, () => {
            beforeEach(() => freeze(clock));

            it('test_it_counts_only_cards_assigned_to_the_user', async () => {
                const user = await createUser();
                const colleague = await createUser();
                const board = await createBoard(user);
                await addMember(board, colleague, 'member');

                await cardIn(board, { dueAt: addAppDays(new Date(), -1) }, user);
                // `now()->addHours(2)` do legado: só é "hoje" se faltarem 2 h para a
                // meia-noite — o legado falharia depois das 22:00. Aqui, o último
                // instante do dia no fuso do app, que é "hoje" a qualquer hora.
                await cardIn(board, { dueAt: endOfAppDay(new Date()) }, user);
                await cardIn(board, { dueAt: addAppDays(new Date(), -3) }, colleague);

                const data = await loadDashboard(user);

                expect(data.stats.overdue).toBe(1);
                expect(data.stats.today).toBe(1);
                expect(data.breakdown.overdue).toBe(1);
                expect(data.deadlines).toHaveLength(2);
                // A mesma comparação de string do legado (os dois com o offset do app).
                expect(data.deadlines[0]!.due_at! < toAppIso(new Date())!).toBe(true);
            });

            it('test_the_board_progress_counts_every_card_not_only_the_users', async () => {
                const user = await createUser();
                const board = await createBoard(user, { title: 'Compartilhado' });

                await cardIn(board, { completedAt: new Date() });
                await cardIn(board);
                await cardIn(board, { dueAt: addAppDays(new Date(), -1) });

                const data = await loadDashboard(user);

                expect(data.boards[0]).toMatchObject({ title: 'Compartilhado', total: 3, done: 1, overdue: 1 });
            });

            it('test_the_trend_fills_days_without_movement', async () => {
                const user = await createUser();
                const board = await createBoard(user);
                await cardIn(board);

                const data = await loadDashboard(user);

                expect(data.trend).toHaveLength(14);
                expect(data.trend[13]!.created).toBe(1);
                expect(data.trend[0]!.created).toBe(0);
            });

            it('test_boards_of_other_people_never_appear', async () => {
                const user = await createUser();
                const stranger = await createBoard(await createUser());
                await cardIn(stranger, { dueAt: addAppDays(new Date(), -1) });

                const data = await loadDashboard(user);

                expect(data.stats.boards).toBe(0);
                expect(data.boards).toHaveLength(0);
                expect(data.deadlines).toHaveLength(0);
            });
        });
    }

    it('test_the_activity_feed_is_deferred', async () => {
        const user = await createUser();
        await createBoard(user);

        expect(await loadDashboard(user)).not.toHaveProperty('activity');
        expect(Array.isArray(await loadDashboardActivity(user))).toBe(true);
    });
});

describe('DailyDigestTest', () => {
    for (const clock of CLOCKS) {
        it(`test_it_splits_cards_between_overdue_today_and_upcoming (agora = ${clock})`, async () => {
            freeze(clock);

            const user = await createUser();
            const board = await createBoard(user);

            await assignedCard(user, { title: 'Atrasado', dueAt: addAppDays(new Date(), -2) }, board);
            // `now()->addHours(3)`: o legado também só acerta longe da meia-noite.
            await assignedCard(user, { title: 'Para hoje', dueAt: endOfAppDay(new Date()) }, board);
            await assignedCard(user, { title: 'Semana que vem', dueAt: addAppDays(new Date(), 3) }, board);
            await assignedCard(user, { title: 'Mês que vem', dueAt: addAppDays(new Date(), 30) }, board);
            await assignedCard(user, { title: 'Sem prazo' }, board);

            const digest = await taskDigestFor(user);

            expect(digest.overdue.map((card) => card.title)).toEqual(['Atrasado']);
            expect(digest.today.map((card) => card.title)).toEqual(['Para hoje']);
            expect(digest.upcoming.map((card) => card.title)).toEqual(['Semana que vem']);
            expect(digest.openCount).toBe(5);
        });
    }

    it('test_it_ignores_cards_of_other_people_and_of_boards_the_user_left', async () => {
        const user = await createUser();
        const other = await createUser();

        const shared = await createBoard(user);
        await cardIn(shared, { dueAt: addAppDays(new Date(), -1) }, other);

        const left = await createBoard(other);
        await assignedCard(user, { dueAt: addAppDays(new Date(), -1) }, left);

        expect(isDigestEmpty(await taskDigestFor(user))).toBe(true);
    });

    it('test_the_command_sends_only_to_people_with_something_to_report', async () => {
        const comTarefa = await createUser();
        await assignedCard(comTarefa, { dueAt: addAppDays(new Date(), -1) });

        await createUser();

        await digestCommand();

        expect(sentMail).toHaveLength(1);
        expect(sentMail[0]!.to).toBe(comTarefa.email);
    });

    it('test_it_respects_the_opt_out', async () => {
        const user = await createUser({ dailyDigest: false });
        await assignedCard(user, { dueAt: addAppDays(new Date(), -1) });

        await digestCommand();

        expect(sentMail).toHaveLength(0);
    });

    for (const clock of CLOCKS) {
        it(`test_it_does_not_send_twice_on_the_same_day (agora = ${clock})`, async () => {
            freeze(clock);

            const user = await createUser();
            await assignedCard(user, { dueAt: addAppDays(new Date(), -1) });

            await digestCommand();
            await digestCommand();

            expect(sentMail).toHaveLength(1);
            expect((await reload(user)).digestLastSentAt).not.toBeNull();

            await digestCommand('?force=1');
            expect(sentMail).toHaveLength(2);
        });
    }

    it('test_dry_run_sends_nothing', async () => {
        const user = await createUser();
        await assignedCard(user, { dueAt: addAppDays(new Date(), -1) });

        await digestCommand('?dry-run=1');

        expect(sentMail).toHaveLength(0);
        expect((await reload(user)).digestLastSentAt).toBeNull();
    });

    it('test_the_settings_page_previews_the_next_digest', async () => {
        const user = await createUser();
        await assignedCard(user, { dueAt: addAppDays(new Date(), -1) });

        const settings = await notificationSettingsFor(await reload(user));

        expect(settings.dailyDigest).toBe(true);
        expect(settings.preview.overdue).toBe(1);
    });

    it('test_the_toggle_persists', async () => {
        const user = await createUser();

        request.user = user;

        expect((await updateDigestPreference({ daily_digest: false })).ok).toBe(true);
        expect((await reload(user)).dailyDigest).toBe(false);
    });

    it('test_the_test_send_does_not_consume_the_day', async () => {
        const user = await createUser();
        await assignedCard(user, { dueAt: addAppDays(new Date(), -1) });

        request.user = await reload(user);

        expect((await sendTestDigest()).ok).toBe(true);
        expect(sentMail).toHaveLength(1);

        await digestCommand();
        expect(sentMail).toHaveLength(2);
    });
});
