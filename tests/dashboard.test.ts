import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addAppDays, endOfAppDay, startOfAppDay } from '@/lib/timezone';
import { proxy } from '@/proxy';
import type { BoardListRow, BoardRow, UserRow, cards } from '@/server/db/schema';
import { loadDashboard, loadDashboardActivity } from '@/server/queries/dashboard';
import { logActivity } from '@/server/services/activity';
import { taskDigestFor } from '@/server/services/task-digest';
import { addMember, assign, createBoard, createCard, createList, createUser } from './support/factories';

/**
 * O antigo DashboardTest (+ os casos do CompletionTest sobre a fronteira do
 * dia), no nível da consulta: `loadDashboard` é exatamente o que a página
 * entrega ao painel.
 *
 * O relógio fica parado numa segunda-feira, 12/10/2026, 10:00 em São Paulo —
 * longe da meia-noite, para "daqui a 2 horas" continuar sendo hoje.
 */
const NOW = new Date('2026-10-12T13:00:00Z');

const hoursFromNow = (hours: number) => new Date(Date.now() + hours * 3_600_000);

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
});

afterEach(() => {
    vi.useRealTimers();
});

/** Um card numa lista nova do quadro, opcionalmente atribuído a alguém. */
async function cardIn(board: BoardRow, overrides: Partial<typeof cards.$inferInsert> = {}, assignee?: UserRow) {
    const list = await createList(board);
    const card = await createCard(list, overrides);

    if (assignee) await assign(card, assignee);

    return card;
}

describe('painel', () => {
    it('conta só os cards atribuídos à pessoa', async () => {
        const user = await createUser();
        const colleague = await createUser();
        const board = await createBoard(user);
        await addMember(board, colleague);

        await cardIn(board, { dueAt: addAppDays(NOW, -1) }, user);
        await cardIn(board, { dueAt: hoursFromNow(2) }, user);
        // Mesmo quadro, mas é problema do colega: não entra nos números da pessoa.
        await cardIn(board, { dueAt: addAppDays(NOW, -3) }, colleague);

        const data = await loadDashboard(user);

        expect(data.stats.overdue).toBe(1);
        expect(data.stats.today).toBe(1);
        expect(data.breakdown.overdue).toBe(1);
        expect(data.deadlines).toHaveLength(2);
        // Vencidas primeiro, para o incêndio aparecer antes da agenda.
        expect(new Date(data.deadlines[0]!.due_at!).getTime()).toBeLessThan(Date.now());
    });

    it('o progresso do quadro conta todos os cards, não só os da pessoa', async () => {
        const user = await createUser();
        const board = await createBoard(user, { title: 'Compartilhado' });

        await cardIn(board, { completedAt: new Date() });
        await cardIn(board);
        await cardIn(board, { dueAt: addAppDays(NOW, -1) });

        const data = await loadDashboard(user);

        expect(data.boards[0]).toMatchObject({ title: 'Compartilhado', total: 3, done: 1, overdue: 1 });
    });

    it('o ritmo preenche os dias sem movimento', async () => {
        const user = await createUser();
        const board = await createBoard(user);
        await cardIn(board);

        const data = await loadDashboard(user);

        expect(data.trend).toHaveLength(14);
        expect(data.trend[13]).toEqual({ date: '2026-10-12', created: 1, completed: 0 });
        expect(data.trend[0]).toEqual({ date: '2026-09-29', created: 0, completed: 0 });
    });

    it('o ritmo agrupa pelo dia no fuso do app, não em UTC', async () => {
        const user = await createUser();
        const board = await createBoard(user);

        // 01:00 UTC do dia 12 ainda é 22:00 do dia 11 em São Paulo.
        await cardIn(board, { createdAt: new Date('2026-10-12T01:00:00Z'), completedAt: new Date('2026-10-12T02:59:00Z') });

        const data = await loadDashboard(user);
        const day = (date: string) => data.trend.find((point) => point.date === date);

        expect(day('2026-10-11')).toEqual({ date: '2026-10-11', created: 1, completed: 1 });
        expect(day('2026-10-12')).toEqual({ date: '2026-10-12', created: 0, completed: 0 });
    });

    it('o ritmo é memória: concluído e arquivado continua contando, abandonado não', async () => {
        const user = await createUser();
        const board = await createBoard(user);

        await cardIn(board, { completedAt: new Date(), archivedAt: new Date() });
        await cardIn(board, { archivedAt: new Date() });

        const data = await loadDashboard(user);

        expect(data.trend[13]).toMatchObject({ created: 1, completed: 1 });
        expect(data.boards[0]).toMatchObject({ total: 1, done: 1 });
    });

    it('quadros de outras pessoas nunca aparecem', async () => {
        const user = await createUser();
        const stranger = await createBoard(await createUser());
        await cardIn(stranger, { dueAt: addAppDays(NOW, -1) });

        const data = await loadDashboard(user);

        expect(data.stats.boards).toBe(0);
        expect(data.boards).toHaveLength(0);
        expect(data.deadlines).toHaveLength(0);
    });

    it('quadro arquivado sai do painel inteiro', async () => {
        const user = await createUser();
        const board = await createBoard(user, { archivedAt: new Date() });
        await cardIn(board, { dueAt: addAppDays(NOW, -1) }, user);

        const data = await loadDashboard(user);

        expect(data.stats).toMatchObject({ boards: 0, overdue: 0, open: 0 });
        expect(data.boards).toHaveLength(0);
        expect(data.trend.every((point) => point.created === 0)).toBe(true);
    });

    it('separa as tarefas abertas pelas mesmas fronteiras do resumo', async () => {
        const user = await createUser();
        const board = await createBoard(user);

        await cardIn(board, { dueAt: addAppDays(NOW, -1) }, user);
        await cardIn(board, { dueAt: endOfAppDay(NOW) }, user);
        await cardIn(board, { dueAt: addAppDays(NOW, 3) }, user);
        await cardIn(board, { dueAt: addAppDays(NOW, 30) }, user);
        await cardIn(board, {}, user);
        // Concluído não é tarefa aberta, nem com prazo velho.
        await cardIn(board, { dueAt: addAppDays(NOW, -5), completedAt: new Date() }, user);

        const data = await loadDashboard(user);

        expect(data.breakdown).toEqual({ overdue: 1, today: 1, upcoming: 1, later: 1, none: 1 });
        expect(data.stats).toMatchObject({ open: 5, overdue: 1, today: 1, upcoming: 1 });
        expect(data.horizonDays).toBe(7);
    });

    it('conta as concluídas da semana e da anterior, inclusive as já arquivadas', async () => {
        const user = await createUser();
        const board = await createBoard(user);

        await cardIn(board, { completedAt: addAppDays(NOW, -2) }, user);
        // Concluído na segunda e arquivado na quarta continua sendo trabalho feito.
        await cardIn(board, { completedAt: addAppDays(NOW, -3), archivedAt: addAppDays(NOW, -1) }, user);
        await cardIn(board, { completedAt: addAppDays(NOW, -10) }, user);
        // De outra pessoa: não entra.
        await cardIn(board, { completedAt: addAppDays(NOW, -1) });

        const data = await loadDashboard(user);

        expect(data.stats.completed_week).toBe(2);
        expect(data.stats.completed_previous_week).toBe(1);
    });

    it('mostra no máximo seis prazos e seis quadros', async () => {
        const user = await createUser();
        const busy = await createBoard(user, { title: 'Cheio' });
        const list: BoardListRow = await createList(busy);

        for (let day = 1; day <= 8; day++) {
            const card = await createCard(list, { dueAt: addAppDays(NOW, -day) });
            await assign(card, user);
        }

        for (let index = 0; index < 6; index++) await createBoard(user, { title: `Quadro ${index}` });

        const data = await loadDashboard(user);

        expect(data.deadlines).toHaveLength(6);
        expect(data.stats.boards).toBe(7);
        expect(data.boards).toHaveLength(6);
        // O mais cheio primeiro; empate, pelo título.
        expect(data.boards[0]!.title).toBe('Cheio');
        expect(data.boards.slice(1).map((board) => board.title)).toEqual([
            'Quadro 0',
            'Quadro 1',
            'Quadro 2',
            'Quadro 3',
            'Quadro 4',
        ]);
    });

    it('o feed de atividade não vem com o painel: chega depois, com o quadro de cada evento', async () => {
        const user = await createUser();
        const board = await createBoard(user, { title: 'Meu quadro', background: 'ocean' });
        const stranger = await createBoard(await createUser());

        for (let minute = 0; minute < 14; minute++) {
            vi.setSystemTime(new Date(NOW.getTime() + minute * 60_000));
            await logActivity({ boardId: board.id, userId: user.id, type: 'card.created', description: `criou o card ${minute}` });
        }

        await logActivity({ boardId: stranger.id, userId: null, type: 'card.created', description: 'de outro quadro' });

        const data = await loadDashboard(user);

        expect(data).not.toHaveProperty('activity');

        const activity = await loadDashboardActivity(user);

        expect(activity).toHaveLength(12);
        expect(activity[0]).toMatchObject({
            description: 'criou o card 13',
            board: { id: board.id, title: 'Meu quadro', background: 'ocean' },
            user: { id: user.id, name: user.name },
        });
        expect(activity.map((item) => item.description)).not.toContain('de outro quadro');
    });

    it('visitante vai para o login', () => {
        const response = proxy(new NextRequest('http://taskon.test/dashboard'));

        expect(response.status).toBe(307);
        expect(response.headers.get('location')).toBe('http://taskon.test/login?next=%2Fdashboard');
    });
});

/**
 * A coluna de conclusão e a fronteira entre "vence hoje" e "vencida" — os
 * casos do antigo CompletionTest que tocam o painel e o resumo. Vieram do
 * mesmo relato: o painel mostrava como vencido um card que estava na coluna
 * "Concluído" e outro que vencia mais tarde no mesmo dia.
 */
describe('a fronteira do dia', () => {
    let user: UserRow;
    let board: BoardRow;
    let todo: BoardListRow;
    let done: BoardListRow;

    beforeEach(async () => {
        user = await createUser();
        board = await createBoard(user);
        todo = await createList(board, { position: 1 });
        done = await createList(board, { position: 2, isDone: true });
    });

    it('um card que vence mais tarde hoje não está vencido', async () => {
        const card = await createCard(todo, { dueAt: new Date(startOfAppDay(NOW).getTime() + 3_600_000) });
        await assign(card, user);

        // Prazo à 01:00, agora é bem mais tarde — mas ainda é hoje.
        vi.setSystemTime(new Date(startOfAppDay(NOW).getTime() + 15 * 3_600_000));

        const digest = await taskDigestFor(user);

        expect(digest.overdue).toHaveLength(0);
        expect(digest.today.map((item) => item.id)).toEqual([card.id]);
    });

    it('um card de ontem está vencido', async () => {
        const card = await createCard(todo, { dueAt: endOfAppDay(addAppDays(NOW, -1)) });
        await assign(card, user);

        const digest = await taskDigestFor(user);

        expect(digest.overdue.map((item) => item.id)).toEqual([card.id]);
    });

    it('o painel concorda com o resumo', async () => {
        const today = await createCard(todo, { dueAt: new Date(startOfAppDay(NOW).getTime() + 3_600_000) });
        await assign(today, user);

        const late = await createCard(todo, { dueAt: addAppDays(NOW, -2) });
        await assign(late, user);

        // Card na coluna de conclusão com prazo velho: concluído, não vencido.
        const finished = await createCard(done, { dueAt: addAppDays(NOW, -5), completedAt: addAppDays(NOW, -1) });
        await assign(finished, user);

        vi.setSystemTime(new Date(startOfAppDay(NOW).getTime() + 15 * 3_600_000));

        const data = await loadDashboard(user);

        expect(data.stats.overdue).toBe(1);
        expect(data.stats.today).toBe(1);
        expect(data.breakdown.overdue).toBe(1);
        expect(data.breakdown.today).toBe(1);
        expect(data.boards[0]).toMatchObject({ id: board.id, overdue: 1 });
    });
});
