import 'server-only';

import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, sql } from 'drizzle-orm';
import type { Activity, BoardProgress, DashboardStats, Deadline, DueBreakdown, TrendPoint } from '@/types';
import { APP_TIMEZONE, addAppDays, startOfAppDay, wallClock } from '@/lib/timezone';
import { config } from '@/server/config';
import { db } from '@/server/db';
import { activities, boardUser, boards, cards, users, type UserRow } from '@/server/db/schema';
import { assignedTo, counted } from '@/server/queries/scopes';
import { activityResource } from '@/server/resources/common';
import { boardProgressResource, deadlineResource } from '@/server/resources/dashboard';
import { dayBoundaries, taskDigestFor } from '@/server/services/task-digest';

/**
 * O painel — o antigo `DashboardController`.
 *
 * Duas escalas convivem aqui, e a tela deixa isso explícito nos títulos:
 *
 *   - "Suas tarefas" — só os cards ATRIBUÍDOS à pessoa (`assignedTo`), o
 *     mesmo recorte do resumo diário por e-mail. Se divergirem, o e-mail passa
 *     a mentir sobre a tela.
 *   - "Seus quadros" — tudo que existe nos quadros de que ela participa,
 *     incluindo o trabalho dos colegas.
 *
 * São ~10 consultas, todas agregadas: nenhuma traz linha que a tela não use.
 * As independentes saem juntas — no Postgres da Vercel cada ida ao banco é uma
 * viagem de rede, e somá-las em fila atrasaria a primeira pintura à toa.
 */

/** Dias do gráfico de ritmo. 14 cabe em duas semanas cheias sem virar borrão. */
const TREND_DAYS = 14;

/** Quantos quadros e prazos a tela mostra antes de mandar para a lista completa. */
const TOP_BOARDS = 6;

const TOP_DEADLINES = 6;

/** Eventos no feed de atividade do painel. */
const ACTIVITY_LIMIT = 12;

export interface DashboardData {
    stats: DashboardStats;
    breakdown: DueBreakdown;
    deadlines: Deadline[];
    trend: TrendPoint[];
    boards: BoardProgress[];
    horizonDays: number;
}

/** Os quadros vivos de que a pessoa participa, como subconsulta (`board_id in (...)`). */
function liveBoardsOf(userId: number) {
    return db
        .select({ id: boards.id })
        .from(boards)
        .innerJoin(boardUser, and(eq(boardUser.boardId, boards.id), eq(boardUser.userId, userId)))
        .where(isNull(boards.archivedAt));
}

export async function loadDashboard(user: Pick<UserRow, 'id'>, now: Date = new Date()): Promise<DashboardData> {
    const [digest, boardCount, completedWeek, completedPreviousWeek, dueBreakdown, trendPoints, progress] =
        await Promise.all([
            // O painel só usa as contagens e os cards do retrato; nome e e-mail
            // servem ao e-mail do resumo.
            taskDigestFor({ id: user.id, name: '', email: '' }, now),
            countLiveBoards(user.id),
            completedBetween(user.id, addAppDays(now, -7), now),
            completedBetween(user.id, addAppDays(now, -14), addAppDays(now, -7)),
            breakdown(user.id, now),
            trend(user.id, now),
            boardProgress(user.id, now),
        ]);

    // Vencidas primeiro: quem abre o painel precisa ver o incêndio antes da
    // agenda.
    const deadlines = [...digest.overdue, ...digest.today, ...digest.upcoming].slice(0, TOP_DEADLINES);

    return {
        stats: {
            open: digest.openCount,
            overdue: digest.overdue.length,
            today: digest.today.length,
            upcoming: digest.upcoming.length,
            completed_week: completedWeek,
            completed_previous_week: completedPreviousWeek,
            boards: boardCount,
        },
        breakdown: dueBreakdown,
        deadlines: deadlines.map(deadlineResource),
        trend: trendPoints,
        boards: progress,
        horizonDays: config.digest.horizonDays,
    };
}

/**
 * O feed "Atividade recente": os eventos mais novos de todos os quadros vivos
 * da pessoa, cada um com o quadro de onde veio — o feed mistura vários.
 *
 * É o pedaço mais caro e o menos urgente do painel: a página o entrega como
 * Promise, e ele chega depois da primeira pintura.
 */
export async function loadDashboardActivity(user: Pick<UserRow, 'id'>): Promise<Activity[]> {
    const rows = await db
        .select({
            activity: {
                id: activities.id,
                type: activities.type,
                description: activities.description,
                properties: activities.properties,
                createdAt: activities.createdAt,
            },
            user: {
                id: users.id,
                name: users.name,
                email: users.email,
                avatarColor: users.avatarColor,
                title: users.title,
            },
            board: { id: boards.id, title: boards.title, background: boards.background },
        })
        .from(activities)
        .innerJoin(boards, eq(boards.id, activities.boardId))
        .leftJoin(users, eq(users.id, activities.userId))
        .where(inArray(activities.boardId, liveBoardsOf(user.id)))
        .orderBy(desc(activities.createdAt), desc(activities.id))
        .limit(ACTIVITY_LIMIT);

    return rows.map((row) => activityResource(row.activity, row.user, row.board));
}

async function countLiveBoards(userId: number): Promise<number> {
    const [row] = await db
        .select({ total: count() })
        .from(boards)
        .innerJoin(boardUser, and(eq(boardUser.boardId, boards.id), eq(boardUser.userId, userId)))
        .where(isNull(boards.archivedAt));

    return row?.total ?? 0;
}

/**
 * `history: true` — o card concluído na segunda e arquivado na quarta não
 * pode desaparecer do "concluídas na semana" na quinta. Aqui se conta o que
 * foi feito, e o que foi feito não se desfaz por ter saído da tela.
 *
 * As duas pontas entram (o `whereBetween` do Laravel).
 */
async function completedBetween(userId: number, from: Date, to: Date): Promise<number> {
    const [row] = await db
        .select({ total: count() })
        .from(cards)
        .where(and(assignedTo(userId, true), gte(cards.completedAt, from), lte(cards.completedAt, to)));

    return row?.total ?? 0;
}

/**
 * Distribuição das tarefas abertas por prazo — o anel da tela.
 *
 * Traz só a coluna due_at e separa aqui: uma consulta em vez de cinco COUNTs,
 * e as fronteiras ficam idênticas às do resumo diário porque são as mesmas
 * (`dayBoundaries`) — o dia, não a hora. Ver o comentário em task-digest.ts.
 */
async function breakdown(userId: number, now: Date): Promise<DueBreakdown> {
    const { startOfToday, endOfToday, horizon } = dayBoundaries(now);

    const rows = await db
        .select({ dueAt: cards.dueAt })
        .from(cards)
        .where(and(assignedTo(userId), isNull(cards.completedAt)));

    const dues = rows.map((row) => row.dueAt);

    return {
        overdue: dues.filter((due) => due !== null && due < startOfToday).length,
        today: dues.filter((due) => due !== null && due >= startOfToday && due <= endOfToday).length,
        upcoming: dues.filter((due) => due !== null && due > endOfToday && due <= horizon).length,
        later: dues.filter((due) => due !== null && due > horizon).length,
        none: dues.filter((due) => due === null).length,
    };
}

/** "2026-10-12" a partir de um dia de calendário (o dia pode transbordar o mês). */
function calendarDay(year: number, month: number, day: number): string {
    return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

/**
 * Criados x concluídos por dia, em todos os quadros do usuário.
 *
 * O agrupamento é pelo dia no fuso do app (o mesmo em que os prazos são
 * lidos), e o laço preenche os dias sem movimento — sem isso o gráfico
 * pularia o domingo e mentiria sobre o ritmo.
 */
async function trend(userId: number, now: Date): Promise<TrendPoint[]> {
    const since = startOfAppDay(addAppDays(now, -(TREND_DAYS - 1)));

    // `counted()` e não `isNull(archivedAt)`: o gráfico de ritmo é memória. Se
    // arquivar apagasse os dias passados, ligar o arquivamento automático de 3
    // dias achataria a linha de "concluídos" para zero em quase todo o
    // período — exatamente o oposto do que aconteceu.
    const perDay = async (column: typeof cards.createdAt | typeof cards.completedAt) => {
        const rows = await db
            .select({
                day: sql<string>`to_char((${column} at time zone ${APP_TIMEZONE})::date, 'YYYY-MM-DD')`,
                total: count(),
            })
            .from(cards)
            .where(and(inArray(cards.boardId, liveBoardsOf(userId)), counted(), gte(column, since)))
            // Pela posição: o fuso vai como parâmetro, e o Postgres não
            // reconhece duas expressões com parâmetros diferentes como iguais.
            .groupBy(sql`1`);

        return new Map(rows.map((row) => [row.day, row.total]));
    };

    const [created, completed] = await Promise.all([perDay(cards.createdAt), perDay(cards.completedAt)]);
    const start = wallClock(since);

    return Array.from({ length: TREND_DAYS }, (_, offset) => {
        const date = calendarDay(start.year, start.month, start.day + offset);

        return { date, created: created.get(date) ?? 0, completed: completed.get(date) ?? 0 };
    });
}

/**
 * Progresso dos quadros vivos da pessoa, os mais cheios primeiro.
 *
 * Total e concluídos seguem o recorte de progresso (o arquivado que já estava
 * pronto continua contando dos dois lados); vencidos, não — arquivado não é
 * mais problema de ninguém.
 */
async function boardProgress(userId: number, now: Date): Promise<BoardProgress[]> {
    const total = sql<number>`count(${cards.id}) filter (where ${counted()})`.mapWith(Number);

    const rows = await db
        .select({
            id: boards.id,
            title: boards.title,
            background: boards.background,
            total,
            done: sql<number>`count(${cards.id}) filter (where ${isNotNull(cards.completedAt)})`.mapWith(Number),
            overdue: sql<number>`count(${cards.id}) filter (where ${and(
                isNull(cards.archivedAt),
                isNull(cards.completedAt),
                // startOfDay, não now: o mesmo corte do resto do painel.
                lt(cards.dueAt, startOfAppDay(now)),
            )})`.mapWith(Number),
        })
        .from(boards)
        .innerJoin(boardUser, and(eq(boardUser.boardId, boards.id), eq(boardUser.userId, userId)))
        .leftJoin(cards, eq(cards.boardId, boards.id))
        .where(isNull(boards.archivedAt))
        .groupBy(boards.id)
        .orderBy(desc(total), asc(boards.title))
        .limit(TOP_BOARDS);

    return rows.map(boardProgressResource);
}
