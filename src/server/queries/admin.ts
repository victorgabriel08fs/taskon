import 'server-only';

import { and, count, desc, eq, gte, ilike, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { AdminFilter, AdminPanelData, AdminStats } from '@/types';
import { addAppDays } from '@/lib/timezone';
import { config } from '@/server/config';
import { db } from '@/server/db';
import { adminEvents, boardUser, boards, cards, sessions, users } from '@/server/db/schema';
import { abort } from '@/server/errors';
import { adminAccess, type AdminSubject } from '@/server/policies/admin';
import { adminEventResource, adminUserResource } from '@/server/resources/admin';
import { MAX_ID } from '@/server/validation';

/**
 * O painel de administração (/admin): os números do topo, a lista de contas
 * (busca, filtro e página na URL) e o histórico.
 *
 * Tudo sai de um número FIXO de consultas, que saem juntas: a última atividade
 * e os quadros de cada conta são subconsultas correlacionadas da própria
 * consulta da página, e quem bloqueou vem num join — nada de N+1.
 */

/**
 * O que a página repassa de `searchParams`. Parâmetro repetido na URL
 * (`?q=a&q=b`) chega como array; vale o primeiro, como no `URLSearchParams.get`.
 */
export interface AdminPanelParams {
    q?: string | string[] | null;
    filter?: string | string[] | null;
    page?: string | string[] | number | null;
}

const FILTERS = ['all', 'admins', 'blocked'] as const satisfies readonly AdminFilter[];

/** Teto da busca, em caracteres. */
const MAX_SEARCH = 100;

/**
 * Nenhuma lista passa disto nem com todos os ids do `integer` ocupados. O teto
 * segura um `?page=` absurdo antes do OFFSET — que o banco recusaria (500) em
 * vez de mostrar a última página.
 */
const MAX_PAGE = Math.ceil(MAX_ID / config.admin.usersPerPage);

/** Quem bloqueou, na mesma consulta da página. */
const blocker = alias(users, 'blocker');

export async function loadAdminPanel(
    viewer: AdminSubject,
    params: AdminPanelParams,
    now: Date = new Date(),
): Promise<AdminPanelData> {
    const access = adminAccess(viewer);

    // 404, não 403: para quem não administra (nem para o nativo que ainda não
    // confirmou o e-mail), o painel não existe.
    if (access !== 'native' && access !== 'admin') abort(404);

    const q = searchTerm(params.q);
    const filter = filterOf(params.filter);
    const requested = pageOf(params.page);
    const perPage = config.admin.usersPerPage;
    const where = matching(q, filter);

    // A página pedida sai junto com a contagem, sem esperar por ela: só um
    // link velho (ou um filtro que encolheu a lista) pede página que não
    // existe, e só então custa uma ida a mais ao banco.
    const [total, requestedRows, stats, events] = await Promise.all([
        db.$count(users, where),
        usersPage(where, requested),
        adminStats(now),
        recentEvents(),
    ]);

    const pages = Math.max(1, Math.ceil(total / perPage));
    const page = Math.min(requested, pages);
    const rows = page === requested ? requestedRows : await usersPage(where, page);

    return {
        viewer: { access },
        stats,
        users: rows.map((row) => adminUserResource(row, viewer)),
        pagination: { page, per_page: perPage, total, pages },
        filters: { q, filter },
        events: events.map(adminEventResource),
    };
}

/** Uma página da lista: a mais nova primeiro, sem destaque para admin ou bloqueado. */
function usersPage(where: SQL | undefined, page: number) {
    const perPage = config.admin.usersPerPage;

    return db
        .select({
            id: users.id,
            name: users.name,
            email: users.email,
            avatarColor: users.avatarColor,
            createdAt: users.createdAt,
            emailVerifiedAt: users.emailVerifiedAt,
            isAdmin: users.isAdmin,
            blockedAt: users.blockedAt,
            blockedByName: blocker.name,

            // A última atividade entre as sessões guardadas (o índice de
            // sessions.user_id resolve cada linha). Sem sessão, o `max` é null
            // — daí o tipo; o decoder da coluna converte o texto do driver.
            lastSeenAt: sql`(select max(${sessions.lastActivityAt}) from ${sessions} where ${sessions.userId} = ${users.id})`
                .mapWith(sessions.lastActivityAt) as SQL<Date | null>,

            // Toda participação conta, inclusive em quadro arquivado: é o
            // tamanho da presença da conta no Taskon, não a tela de quadros dela.
            boardsCount: db.$count(boardUser, eq(boardUser.userId, users.id)),
        })
        .from(users)
        .leftJoin(blocker, eq(blocker.id, users.blockedBy))
        .where(where)
        .orderBy(desc(users.createdAt), desc(users.id))
        .limit(perPage)
        .offset((page - 1) * perPage);
}

/**
 * Os números do topo. "Admins" conta só quem tem acesso AGORA — nativo com o
 * e-mail confirmado ou admin concedido, sem bloqueio. Quem decide é a própria
 * política (`adminAccess`), aplicada às poucas contas candidatas: escrever a
 * regra de novo em SQL seria uma segunda cópia esperando para divergir.
 */
async function adminStats(now: Date): Promise<AdminStats> {
    // Os últimos 7 dias de calendário, no fuso do app.
    const weekAgo = addAppDays(now, -7);

    const [[totals], candidates] = await Promise.all([
        db
            .select({
                users: count(),
                blocked: sql<number>`count(*) filter (where ${isNotNull(users.blockedAt)})`.mapWith(Number),
                newThisWeek: sql<number>`count(*) filter (where ${gte(users.createdAt, weekAgo)})`.mapWith(Number),
                boards: db.$count(boards),
                cards: db.$count(cards),
            })
            .from(users),
        db
            .select({
                id: users.id,
                email: users.email,
                emailVerifiedAt: users.emailVerifiedAt,
                isAdmin: users.isAdmin,
                blockedAt: users.blockedAt,
            })
            .from(users)
            .where(adminCandidates()),
    ]);

    return {
        users: totals?.users ?? 0,
        admins: candidates.filter((user) => {
            const access = adminAccess(user);

            return access === 'native' || access === 'admin';
        }).length,
        blocked: totals?.blocked ?? 0,
        new_this_week: totals?.newThisWeek ?? 0,
        boards: totals?.boards ?? 0,
        cards: totals?.cards ?? 0,
    };
}

/** O histórico: os mais recentes primeiro, com o nome de quem fez. */
function recentEvents() {
    return db
        .select({
            id: adminEvents.id,
            type: adminEvents.type,
            actorName: users.name,
            targetName: adminEvents.targetName,
            targetEmail: adminEvents.targetEmail,
            createdAt: adminEvents.createdAt,
        })
        .from(adminEvents)
        .leftJoin(users, eq(users.id, adminEvents.actorId))
        .orderBy(desc(adminEvents.createdAt), desc(adminEvents.id))
        .limit(config.admin.eventsShown);
}

/**
 * Quem pode ser admin: `is_admin` ou e-mail da lista de nativos — confirmado
 * ou não, bloqueado ou não. É o filtro "Admins" da lista (quem administra
 * precisa achar também o admin bloqueado e o nativo pendente) e a base da
 * contagem de admins ativos.
 */
function adminCandidates(): SQL {
    return or(eq(users.isAdmin, true), inArray(users.email, config.admin.nativeEmails))!;
}

/** Busca (nome ou e-mail) + filtro da aba. Sem nenhum dos dois, a lista inteira. */
function matching(q: string, filter: AdminFilter): SQL | undefined {
    const pattern = `%${escapeLike(q)}%`;

    return and(
        q === '' ? undefined : or(ilike(users.name, pattern), ilike(users.email, pattern)),
        filter === 'admins' ? adminCandidates() : undefined,
        filter === 'blocked' ? isNotNull(users.blockedAt) : undefined,
    );
}

/**
 * `%` e `_` são curingas do LIKE, e `\` é o escape padrão dele no Postgres: os
 * três viram literais. Sem isso, buscar "_" acharia todo mundo.
 */
function escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, '\\$&');
}

function first<T>(value: T | T[] | null | undefined): T | undefined {
    return Array.isArray(value) ? value[0] : (value ?? undefined);
}

/** Caractere de controle (C0, DEL, C1): não existe em nome nem em e-mail. */
function isControl(char: string): boolean {
    const code = char.codePointAt(0) ?? 0;

    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
}

/**
 * O termo da busca: sem caractere de controle (o NUL derrubaria a consulta — o
 * Postgres recusa `\0` em texto), aparado e com até 100 caracteres (contados
 * como caracteres, não unidades UTF-16).
 */
function searchTerm(value: AdminPanelParams['q']): string {
    const raw = first(value);

    if (typeof raw !== 'string') return '';

    const visible = [...raw].filter((char) => !isControl(char)).join('').trim();

    return [...visible].slice(0, MAX_SEARCH).join('').trimEnd();
}

function filterOf(value: AdminPanelParams['filter']): AdminFilter {
    const raw = first(value);

    return FILTERS.find((filter) => filter === raw) ?? 'all';
}

/** A página pedida: inteiro a partir de 1; qualquer outra coisa é a primeira. */
function pageOf(value: AdminPanelParams['page']): number {
    const raw = first(value);
    const text = typeof raw === 'string' ? raw.trim() : null;
    const page = typeof raw === 'number' ? raw : text !== null && /^\d+$/.test(text) ? Number(text) : Number.NaN;

    if (!Number.isInteger(page) || page < 1) return 1;

    return Math.min(page, MAX_PAGE);
}
