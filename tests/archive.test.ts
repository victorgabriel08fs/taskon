import { and, count, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Toast } from '@/types';
import { GET as cronArchiveDoneCards } from '@/app/api/cron/archive-done-cards/route';
import {
    archiveCard as archiveCardAction,
    archiveDoneCards as archiveDoneCardsAction,
    loadArchivedCards as loadArchivedCardsAction,
    restoreCard as restoreCardAction,
} from '@/server/actions/archive';
import { db } from '@/server/db';
import {
    activities,
    boardLists,
    boards,
    cards,
    rateLimits,
    sessions,
    type BoardListRow,
    type BoardRow,
    type UserRow,
} from '@/server/db/schema';
import { loadArchivedCards } from '@/server/queries/card';
import { archiveCard, restoreCard } from '@/server/services/cards';
import { archiveDoneNow, describeSweep, pendingCount, sweepBoards } from '@/server/services/done-card-archiver';
import { expectHttpError } from './support/assertions';
import { addMember, createBoard, createCard, createList, createUser, fresh } from './support/factories';

/**
 * O arquivamento automático dos concluídos (o AutoArchiveTest do Laravel).
 *
 * A coluna "Concluído" cresce sem parar e acaba abafando o que falta. Cada
 * quadro escolhe um prazo, e a varredura da madrugada tira de lá o que já
 * passou dele.
 *
 * Os testes que leem o quadro, o painel e a lista de quadros (o card sai do
 * payload, o progresso não regride, a conclusão continua contando na semana)
 * moram com os loaders desses trechos.
 */
const request = vi.hoisted(() => ({ user: null as UserRow | null, flashed: [] as Toast[] }));

// Só a sessão da requisição é dublê; a faxina (`pruneExpiredSessions`) é a de verdade.
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

const NOW = new Date('2026-10-12T15:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

let board: BoardRow;
let user: UserRow;
let todo: BoardListRow;
let done: BoardListRow;

beforeEach(async () => {
    // O relógio congelado (o Carbon::setTestNow): "8 dias atrás" não pode
    // depender de quando a suíte roda.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);

    user = await createUser();
    board = await createBoard(user, { autoArchiveDoneAfterDays: 7 });
    todo = await createList(board, { title: 'A fazer', position: 1 });
    done = await createList(board, { title: 'Concluído', position: 2, isDone: true });

    request.user = user;
    request.flashed.length = 0;
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

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

describe('a varredura', () => {
    it('arquiva o que passou do prazo e deixa o resto', async () => {
        const velho = await createCard(done, { completedAt: daysAgo(8) });
        const novo = await createCard(done, { completedAt: daysAgo(2) });

        await sweepBoards();

        expect((await fresh(velho))?.archivedAt?.toISOString()).toBe(NOW.toISOString());
        expect((await fresh(novo))?.archivedAt, 'dentro do prazo o card fica').toBeNull();
    });

    it('conta dias de calendário: exatamente no prazo já sai, um segundo antes não', async () => {
        const noLimite = await createCard(done, { completedAt: daysAgo(7) });
        const quase = await createCard(done, { completedAt: new Date(daysAgo(7).getTime() + 1000) });

        await sweepBoards();

        expect((await fresh(noLimite))?.archivedAt).not.toBeNull();
        expect((await fresh(quase))?.archivedAt).toBeNull();
    });

    it('nunca arquiva um card aberto, por mais velho que seja', async () => {
        // Sem completed_at não há relógio para correr: esquecer uma tarefa não
        // pode ser jeito de se livrar dela.
        const esquecido = await createCard(todo, { createdAt: daysAgo(365), dueAt: daysAgo(180) });

        await sweepBoards();

        expect((await fresh(esquecido))?.archivedAt).toBeNull();
    });

    it('não toca em quadro sem prazo', async () => {
        await db.update(boards).set({ autoArchiveDoneAfterDays: null }).where(eq(boards.id, board.id));
        const card = await createCard(done, { completedAt: daysAgo(365) });

        const report = await sweepBoards();

        expect((await fresh(card))?.archivedAt).toBeNull();
        expect(report.boards).toEqual([]);
        expect(describeSweep(report)).toEqual(['Nenhum quadro com arquivamento automático ligado.']);
    });

    it('não toca em quadro arquivado', async () => {
        await db.update(boards).set({ archivedAt: daysAgo(1) }).where(eq(boards.id, board.id));
        const card = await createCard(done, { completedAt: daysAgo(30) });

        await sweepBoards();

        expect((await fresh(card))?.archivedAt).toBeNull();
    });

    it('o dry-run não arquiva nada, mas conta o mesmo que a varredura levaria', async () => {
        const card = await createCard(done, { completedAt: daysAgo(30) });

        const report = await sweepBoards({ dryRun: true });

        expect((await fresh(card))?.archivedAt).toBeNull();
        expect(report.total).toBe(1);
        expect(await pendingCount(board)).toBe(1);
        expect(describeSweep(report)).toEqual([
            'Simulando a varredura de 1 quadro',
            `  ? ${board.title} · 1 card · prazo de 7 dias`,
            'Sairiam: 1',
        ]);
    });

    it('a opção de quadro restringe a varredura', async () => {
        const outro = await createBoard(user, { autoArchiveDoneAfterDays: 1 });
        const lista = await createList(outro);
        const deFora = await createCard(lista, { completedAt: daysAgo(30) });
        const daqui = await createCard(done, { completedAt: daysAgo(30) });

        await sweepBoards({ boardId: board.id });

        expect((await fresh(daqui))?.archivedAt).not.toBeNull();
        expect((await fresh(deFora))?.archivedAt).toBeNull();
    });

    it('deixa uma linha no histórico por varredura, não uma por card', async () => {
        for (let index = 0; index < 3; index++) await createCard(done, { completedAt: daysAgo(10) });

        const report = await sweepBoards();

        const rows = await db
            .select()
            .from(activities)
            .where(and(eq(activities.boardId, board.id), eq(activities.type, 'cards.auto_archived')));

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            cardId: null,
            // Ninguém clicou: a varredura agendada não tem autor.
            userId: null,
            description: 'arquivou 3 cards concluídos há mais de 7 dias',
            properties: { count: 3, after_days: 7 },
        });
        expect(describeSweep(report)).toEqual([
            'Varrendo 1 quadro',
            `  ✓ ${board.title} · 3 cards · prazo de 7 dias`,
            'Arquivados: 3',
        ]);
    });

    it('não escreve no histórico quando nada saiu', async () => {
        await createCard(done, { completedAt: daysAgo(1) });

        const report = await sweepBoards();

        const [row] = await db.select({ total: count() }).from(activities).where(eq(activities.boardId, board.id));

        expect(row?.total).toBe(0);
        expect(describeSweep(report)[1]).toBe(`  – ${board.title} · nada além de 7 dias`);
    });
});

describe('a gaveta', () => {
    it('lista os arquivados com a lista de onde saíram, os mais recentes primeiro', async () => {
        await createCard(done, { title: 'Antigo', completedAt: daysAgo(10), archivedAt: daysAgo(3) });
        await createCard(todo, { title: 'Recente', archivedAt: daysAgo(1), dueAt: daysAgo(-2) });
        await createCard(todo, { title: 'Vivo' });

        const drawer = await loadArchivedCards(user, board.id);

        expect(drawer).toEqual([
            {
                id: expect.any(Number),
                title: 'Recente',
                list_title: 'A fazer',
                due_at: '2026-10-14T12:00:00-03:00',
                completed_at: null,
                archived_at: '2026-10-11T12:00:00-03:00',
            },
            {
                id: expect.any(Number),
                title: 'Antigo',
                list_title: 'Concluído',
                due_at: null,
                completed_at: '2026-10-02T12:00:00-03:00',
                archived_at: '2026-10-09T12:00:00-03:00',
            },
        ]);
    });

    it('depois da varredura, o card está na gaveta', async () => {
        await createCard(done, { completedAt: daysAgo(10) });
        await sweepBoards();

        const drawer = await loadArchivedCards(user, board.id);

        expect(drawer).toHaveLength(1);
        expect(drawer[0]?.list_title).toBe('Concluído');
    });

    it('para nos 100 mais recentes', async () => {
        const rows = Array.from({ length: 105 }, (_, index) => ({
            boardId: board.id,
            boardListId: todo.id,
            title: `Arquivado ${index}`,
            archivedAt: new Date(NOW.getTime() - index * 60_000),
        }));

        await db.insert(cards).values(rows);

        const drawer = await loadArchivedCards(user, board.id);

        expect(drawer).toHaveLength(100);
        expect(drawer[0]?.title).toBe('Arquivado 0');
        expect(drawer[99]?.title).toBe('Arquivado 99');
    });

    it('quem é de fora não abre a gaveta', async () => {
        await expectHttpError(loadArchivedCards(await createUser(), board.id), 403);
    });

    it('a action de leitura não re-renderiza a página', async () => {
        const { refresh } = await import('next/cache');

        vi.mocked(refresh).mockClear();
        await createCard(todo, { archivedAt: daysAgo(1) });

        const result = await loadArchivedCardsAction({ boardId: board.id });

        expect(result.ok && result.data).toHaveLength(1);
        expect(refresh).not.toHaveBeenCalled();
    });
});

describe('arquivar na mão', () => {
    it('arquiva sem precisar estar concluído', async () => {
        const card = await createCard(todo);

        await archiveCard(user, card.id);

        expect((await fresh(card))?.archivedAt).not.toBeNull();
        expect((await fresh(card))?.completedAt).toBeNull();

        const [activity] = await db.select().from(activities).where(eq(activities.cardId, card.id));

        expect(activity).toMatchObject({ type: 'card.archived', description: `arquivou ${card.title}`, userId: user.id });
    });

    it('volta para o quadro, não para a URL do card, dizendo onde o card foi parar', async () => {
        const card = await createCard(todo, { title: 'Guardar' });

        // Redirect para o quadro: a URL anterior pode ser a do próprio card, e
        // voltar para lá reabriria o modal de um arquivado.
        expect(await redirectOf(archiveCardAction({ cardId: card.id }))).toBe(`/boards/${board.id}`);
        expect(request.flashed).toEqual([
            { type: 'success', message: '"Guardar" foi para Arquivados, no menu do quadro.' },
        ]);
    });

    it('arquivar de novo não mexe na data nem repete o histórico', async () => {
        const card = await createCard(todo, { archivedAt: daysAgo(2) });

        await archiveCard(user, card.id);

        expect((await fresh(card))?.archivedAt?.toISOString()).toBe(daysAgo(2).toISOString());
        expect(await db.select().from(activities).where(eq(activities.cardId, card.id))).toEqual([]);
    });
});

describe('arquivar agora', () => {
    it('roda a mesma varredura, em nome de quem clicou', async () => {
        const velho = await createCard(done, { completedAt: daysAgo(8) });
        const novo = await createCard(done, { completedAt: daysAgo(2) });

        expect(await archiveDoneNow(user, board.id)).toBe(1);

        expect((await fresh(velho))?.archivedAt).not.toBeNull();
        expect((await fresh(novo))?.archivedAt).toBeNull();

        const [activity] = await db.select().from(activities).where(eq(activities.type, 'cards.auto_archived'));

        expect(activity).toMatchObject({ userId: user.id, description: 'arquivou 1 card concluído há mais de 7 dias' });
    });

    it('não faz nada sem prazo', async () => {
        await db.update(boards).set({ autoArchiveDoneAfterDays: null }).where(eq(boards.id, board.id));
        const card = await createCard(done, { completedAt: daysAgo(365) });

        expect(await archiveDoneNow(user, board.id)).toBeNull();
        expect((await fresh(card))?.archivedAt).toBeNull();
    });

    it('avisa o resultado e devolve a gaveta atualizada', async () => {
        await createCard(done, { completedAt: daysAgo(8) });
        await createCard(done, { completedAt: daysAgo(9) });

        const archived = await archiveDoneCardsAction({ boardId: board.id });

        expect(archived).toMatchObject({ ok: true, toast: { type: 'success', message: '2 cards arquivados.' } });
        expect(archived.ok && archived.data).toHaveLength(2);

        expect(await archiveDoneCardsAction({ boardId: board.id })).toMatchObject({
            ok: true,
            toast: { type: 'info', message: 'Nenhum concluído passou do prazo ainda.' },
        });

        await db.update(boards).set({ autoArchiveDoneAfterDays: null }).where(eq(boards.id, board.id));

        expect(await archiveDoneCardsAction({ boardId: board.id })).toMatchObject({
            ok: true,
            toast: { type: 'info', message: 'Escolha um prazo antes de arquivar os concluídos.' },
        });
    });

    it('"1 card arquivado." no singular', async () => {
        await createCard(done, { completedAt: daysAgo(8) });

        expect(await archiveDoneCardsAction({ boardId: board.id })).toMatchObject({
            toast: { type: 'success', message: '1 card arquivado.' },
        });
    });

    it('membro comum não varre: é configuração do quadro', async () => {
        const member = await createUser();

        await addMember(board, member, 'member');

        await expectHttpError(archiveDoneNow(member, board.id), 403);
    });
});

describe('restaurar', () => {
    it('reabre o card e o tira da coluna de conclusão', async () => {
        const card = await createCard(done, { completedAt: daysAgo(10), archivedAt: NOW });

        const result = await restoreCard(user, card.id);

        const restored = await fresh(card);

        expect(restored?.archivedAt).toBeNull();
        // Voltar ainda concluído faria a varredura levá-lo de novo na madrugada
        // seguinte, e a pessoa restauraria o mesmo card todo dia.
        expect(restored?.completedAt, 'restaurar reabre o card').toBeNull();
        expect(restored?.boardListId, 'não volta para a coluna dos prontos').toBe(todo.id);
        expect(result).toEqual({ boardId: board.id, title: card.title, listTitle: 'A fazer' });

        const [activity] = await db.select().from(activities).where(eq(activities.cardId, card.id));

        expect(activity).toMatchObject({ type: 'card.restored', description: `restaurou ${card.title} em A fazer` });
    });

    it('de uma coluna comum, volta para onde estava', async () => {
        const doing = await createList(board, { title: 'Fazendo', position: 3 });
        const card = await createCard(doing, { archivedAt: NOW });

        await restoreCard(user, card.id);

        expect((await fresh(card))?.boardListId).toBe(doing.id);
    });

    it('a primeira coluna comum é a primeira VIVA pela posição', async () => {
        await db.update(boardLists).set({ archivedAt: daysAgo(1) }).where(eq(boardLists.id, todo.id));
        await createList(board, { title: 'Depois', position: 9 });
        const sooner = await createList(board, { title: 'Antes', position: 3 });
        const card = await createCard(done, { completedAt: daysAgo(10), archivedAt: NOW });

        const result = await restoreCard(user, card.id);

        expect((await fresh(card))?.boardListId).toBe(sooner.id);
        expect(result.listTitle).toBe('Antes');
    });

    it('sem nenhuma coluna comum, fica na própria coluna', async () => {
        const onlyDone = await createBoard(user);
        const list = await createList(onlyDone, { title: 'Pronto', isDone: true });
        const card = await createCard(list, { completedAt: daysAgo(10), archivedAt: NOW });

        await restoreCard(user, card.id);

        expect(await fresh(card)).toMatchObject({ boardListId: list.id, archivedAt: null, completedAt: null });
    });

    it('vai para o fim da fila', async () => {
        await createCard(todo, { position: 1 });
        await createCard(todo, { position: 2 });
        await createCard(todo, { position: 40, archivedAt: daysAgo(1) });
        const card = await createCard(done, { completedAt: daysAgo(10), archivedAt: NOW });

        await restoreCard(user, card.id);

        // Os arquivados da coluna não contam: o fim da fila é o do que se vê.
        expect((await fresh(card))?.position).toBe(3);
    });

    it('devolve a gaveta na mesma viagem, com o aviso de para onde o card foi', async () => {
        const card = await createCard(done, { title: 'Volta', completedAt: daysAgo(10), archivedAt: NOW });
        const vizinho = await createCard(done, { completedAt: daysAgo(10), archivedAt: NOW });

        const result = await restoreCardAction({ cardId: card.id });

        expect(result).toMatchObject({ ok: true, toast: { type: 'success', message: '"Volta" voltou para A fazer.' } });
        expect(result.ok && result.data.map((archived) => archived.id)).toEqual([vizinho.id]);
    });

    it('restaurar um card que não está arquivado é 404', async () => {
        const card = await createCard(todo);

        await expectHttpError(restoreCard(user, card.id), 404);
    });

    it('quem é de fora não arquiva nem restaura', async () => {
        const card = await createCard(done, { completedAt: daysAgo(10) });
        const stranger = await createUser();

        await expectHttpError(archiveCard(stranger, card.id), 403);
        await expectHttpError(restoreCard(stranger, card.id), 403);
        await expectHttpError(archiveDoneNow(stranger, board.id), 403);
    });
});

describe('o cron', () => {
    const call = (query = '', authorization?: string) =>
        cronArchiveDoneCards(
            new Request(`http://taskon.test/api/cron/archive-done-cards${query}`, {
                headers: authorization ? { authorization } : {},
            }),
        );

    it('exige o segredo da Vercel quando ele está configurado', async () => {
        vi.stubEnv('CRON_SECRET', 'segredo');
        const card = await createCard(done, { completedAt: daysAgo(30) });

        expect((await call()).status).toBe(401);
        expect((await call('', 'Bearer errado')).status).toBe(401);
        expect((await fresh(card))?.archivedAt).toBeNull();

        const response = await call('', 'Bearer segredo');

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
            ok: true,
            dryRun: false,
            total: 1,
            boards: [{ id: board.id, title: board.title, days: 7, count: 1 }],
            summary: ['Varrendo 1 quadro', `  ✓ ${board.title} · 1 card · prazo de 7 dias`, 'Arquivados: 1'],
            housekeeping: true,
        });
        expect((await fresh(card))?.archivedAt).not.toBeNull();
    });

    it('faz a faxina: sessões vencidas e janelas de rate limit fechadas', async () => {
        await db.insert(sessions).values([
            { id: 'vencida', userId: user.id, expiresAt: daysAgo(1) },
            { id: 'valendo', userId: user.id, expiresAt: daysAgo(-1) },
        ]);
        await db.insert(rateLimits).values([
            { key: 'fechou', hits: 3, resetAt: daysAgo(1) },
            { key: 'aberta', hits: 1, resetAt: daysAgo(-1) },
        ]);

        expect((await call()).status).toBe(200);

        expect((await db.select({ id: sessions.id }).from(sessions)).map((row) => row.id)).toEqual(['valendo']);
        expect((await db.select({ key: rateLimits.key }).from(rateLimits)).map((row) => row.key)).toEqual(['aberta']);
    });

    it('aceita ?dry-run e ?board para testes na mão — e o dry-run não apaga nada', async () => {
        const outro = await createBoard(user, { autoArchiveDoneAfterDays: 1 });
        await createCard(await createList(outro), { completedAt: daysAgo(30) });
        const card = await createCard(done, { completedAt: daysAgo(30) });

        await db.insert(sessions).values({ id: 'vencida', userId: user.id, expiresAt: daysAgo(1) });

        const response = await call(`?dry-run=1&board=${board.id}`);

        expect(await response.json()).toMatchObject({
            dryRun: true,
            total: 1,
            boards: [{ id: board.id, count: 1 }],
            housekeeping: false,
        });
        expect((await fresh(card))?.archivedAt).toBeNull();
        expect(await db.select().from(sessions)).toHaveLength(1);

        expect((await call('?board=abc')).status).toBe(422);
    });
});
