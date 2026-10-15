import { randomBytes } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { refresh } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminUserRow } from '@/types';
import { toAppIso } from '@/lib/timezone';
import {
    blockUser as blockUserAction,
    grantAdmin as grantAdminAction,
    revokeAdmin as revokeAdminAction,
    unblockUser as unblockUserAction,
} from '@/server/actions/admin';
import { currentSession, startSession } from '@/server/auth/session';
import { config } from '@/server/config';
import { db } from '@/server/db';
import { adminEvents, boardUser, boards, cards, sessions, users, type UserRow } from '@/server/db/schema';
import { adminAccess } from '@/server/policies/admin';
import { loadAdminPanel } from '@/server/queries/admin';
import {
    ADMIN_MESSAGES,
    blockUser,
    grantAdmin,
    revokeAdmin,
    unblockUser,
    type AdminOperation,
} from '@/server/services/admin';
import { expectHttpError } from './support/assertions';
import { addMember, createBoard, createCard, createList, createUser } from './support/factories';

/**
 * O painel de administração: a hierarquia inteira (quem pode o quê com quem),
 * o bloqueio derrubando as sessões, o histórico, a lista do painel (busca,
 * filtros, páginas, números) e as actions.
 *
 * As actions rodam de verdade; só o `next/headers` é dublê (um pote de
 * cookies em memória), como em tests/invitations.test.ts.
 */
const jar = vi.hoisted(() => {
    const store = new Map<string, string>();

    return {
        store,
        get: (name: string) => (store.has(name) ? { name, value: store.get(name)! } : undefined),
        has: (name: string) => store.has(name),
        set: (name: string, value: string) => {
            store.set(name, value);
        },
        delete: (name: string) => {
            store.delete(name);
        },
        getAll: () => [...store].map(([name, value]) => ({ name, value })),
    };
});

vi.mock('next/headers', () => ({
    cookies: async () => jar,
    headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.21', 'user-agent': 'vitest' }),
}));
vi.mock('next/cache', () => ({ refresh: vi.fn() }));

const NOW = new Date('2026-10-14T15:00:00Z');

/** O primeiro e-mail da lista de nativos: sem NATIVE_ADMIN_EMAILS, victorgabriel08fs@gmail.com. */
const NATIVE_EMAIL = config.admin.nativeEmails[0]!;

/** Um segundo e-mail de nativo — o que NATIVE_ADMIN_EMAILS com dois endereços faria (ver `world`). */
const SECOND_NATIVE_EMAIL = 'segunda-nativa@taskon.test';

const ORIGINAL_NATIVE_EMAILS = [...config.admin.nativeEmails];

beforeEach(() => {
    jar.store.clear();
    vi.mocked(refresh).mockClear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
});

afterEach(() => {
    vi.useRealTimers();
    config.admin.nativeEmails.splice(0, config.admin.nativeEmails.length, ...ORIGINAL_NATIVE_EMAILS);
});

/** O admin nativo: o e-mail da lista, já confirmado. */
function createNative(overrides: Partial<typeof users.$inferInsert> = {}): Promise<UserRow> {
    return createUser({ name: 'Victor Nativo', email: NATIVE_EMAIL, emailVerifiedAt: NOW, ...overrides });
}

interface World {
    native: UserRow;
    admin: UserRow;
    otherAdmin: UserRow;
    user: UserRow;
    blocked: UserRow;
    blockedAdmin: UserRow;
    pending: UserRow;
}

type Who = keyof World;

/**
 * Uma conta de cada tipo. O nativo pendente usa um SEGUNDO e-mail da lista,
 * para conviver com o nativo confirmado (o e-mail é único): a lista é
 * calculada na importação do config, mas a política a relê a cada chamada — e
 * o afterEach devolve a original.
 */
async function world(): Promise<World> {
    config.admin.nativeEmails.push(SECOND_NATIVE_EMAIL);

    const native = await createNative();

    return {
        native,
        admin: await createUser({ name: 'Ana Admin', isAdmin: true }),
        otherAdmin: await createUser({ name: 'Otávio Admin', isAdmin: true }),
        user: await createUser({ name: 'Caio Comum' }),
        blocked: await createUser({ name: 'Bia Bloqueada', blockedAt: NOW, blockedBy: native.id }),
        blockedAdmin: await createUser({ name: 'Beto Admin', isAdmin: true, blockedAt: NOW, blockedBy: native.id }),
        pending: await createUser({ name: 'Paula Pendente', email: SECOND_NATIVE_EMAIL }),
    };
}

const OPERATIONS = {
    grant_admin: grantAdmin,
    revoke_admin: revokeAdmin,
    block: blockUser,
    unblock: unblockUser,
} as const satisfies Record<AdminOperation, unknown>;

const EVENT_TYPES = {
    grant_admin: 'admin.granted',
    revoke_admin: 'admin.revoked',
    block: 'user.blocked',
    unblock: 'user.unblocked',
} as const satisfies Record<AdminOperation, string>;

type Outcome = 'ok' | 403 | 422;

/**
 * A tabela de src/server/policies/admin.ts, célula a célula: quem faz × alvo ×
 * [conceder, tirar admin, bloquear, desbloquear]. 'ok' muda a conta e grava o
 * evento; 403 é a hierarquia; 422 é a operação redundante (ou conceder admin a
 * quem está bloqueado).
 */
const HIERARCHY: [viewer: Who, target: Who, outcomes: [Outcome, Outcome, Outcome, Outcome]][] = [
    ['native', 'native', [403, 403, 403, 403]], // a própria conta
    ['native', 'pending', [403, 403, 403, 403]], // e-mail nativo é intocável, confirmado ou não
    ['native', 'admin', [422, 'ok', 'ok', 422]],
    ['native', 'user', ['ok', 422, 'ok', 422]],
    ['native', 'blocked', [422, 422, 422, 'ok']],
    ['native', 'blockedAdmin', [422, 'ok', 422, 'ok']],

    ['admin', 'admin', [403, 403, 403, 403]], // a própria conta
    ['admin', 'native', [403, 403, 403, 403]],
    ['admin', 'pending', [403, 403, 403, 403]],
    ['admin', 'otherAdmin', [403, 403, 403, 403]], // admin concedido não mexe em colega
    ['admin', 'user', [403, 403, 'ok', 422]],
    ['admin', 'blocked', [403, 403, 422, 'ok']],
    ['admin', 'blockedAdmin', [403, 403, 403, 403]],

    // Sem acesso ativo, nada — nem o que um admin poderia fazer com o alvo.
    ['user', 'blocked', [403, 403, 403, 403]],
    ['user', 'admin', [403, 403, 403, 403]],
    ['pending', 'blocked', [403, 403, 403, 403]], // nativo com o e-mail ainda não confirmado
    ['pending', 'user', [403, 403, 403, 403]],
    ['blockedAdmin', 'blocked', [403, 403, 403, 403]], // admin bloqueado perde o acesso
];

const OPERATION_ORDER = ['grant_admin', 'revoke_admin', 'block', 'unblock'] as const satisfies readonly AdminOperation[];

const CASES = HIERARCHY.flatMap(([viewer, target, outcomes]) =>
    OPERATION_ORDER.map((operation, index) => ({ viewer, target, operation, outcome: outcomes[index]! })),
);

function canOf(outcomes: [Outcome, Outcome, Outcome, Outcome]): AdminUserRow['can'] {
    return {
        grant_admin: outcomes[0] === 'ok',
        revoke_admin: outcomes[1] === 'ok',
        block: outcomes[2] === 'ok',
        unblock: outcomes[3] === 'ok',
    };
}

interface AdminState {
    isAdmin: boolean;
    blockedAt: Date | null;
    blockedBy: number | null;
}

async function stateOf(user: Pick<UserRow, 'id'>): Promise<AdminState | undefined> {
    const [row] = await db
        .select({ isAdmin: users.isAdmin, blockedAt: users.blockedAt, blockedBy: users.blockedBy })
        .from(users)
        .where(eq(users.id, user.id));

    return row;
}

/** O estado que a operação bem-sucedida deixa — e nada além disso muda. */
function changed(operation: AdminOperation, before: AdminState, actor: UserRow): AdminState {
    switch (operation) {
        case 'grant_admin':
            return { ...before, isAdmin: true };
        case 'revoke_admin':
            return { ...before, isAdmin: false };
        case 'block':
            return { ...before, blockedAt: NOW, blockedBy: actor.id };
        case 'unblock':
            return { ...before, blockedAt: null, blockedBy: null };
    }
}

/** Uma sessão gravada direto na tabela, como a de um navegador que já entrou. */
async function openSession(user: Pick<UserRow, 'id'>, lastActivityAt: Date = NOW): Promise<void> {
    await db.insert(sessions).values({
        id: randomBytes(32).toString('hex'),
        userId: user.id,
        lastActivityAt,
        expiresAt: new Date(NOW.getTime() + 86_400_000),
    });
}

/** Loga a pessoa no pote de cookies, como se ela tivesse entrado pelo formulário. */
async function signIn(user: Pick<UserRow, 'id'>): Promise<void> {
    await startSession(user.id, false);
}

describe('a hierarquia', () => {
    it.skipIf(Boolean(process.env.NATIVE_ADMIN_EMAILS))('o admin nativo padrão é victorgabriel08fs@gmail.com', () => {
        expect(config.admin.nativeEmails).toEqual(['victorgabriel08fs@gmail.com']);
    });

    it.each(CASES)('$viewer → $target: $operation = $outcome', async ({ viewer, target, operation, outcome }) => {
        const accounts = await world();
        const actor = accounts[viewer];
        const subject = accounts[target];
        const before = (await stateOf(subject))!;

        if (outcome === 'ok') {
            expect(await OPERATIONS[operation](actor, subject.id)).toEqual({ name: subject.name });
            expect(await stateOf(subject)).toEqual(changed(operation, before, actor));
            expect(await db.select().from(adminEvents)).toEqual([
                expect.objectContaining({
                    actorId: actor.id,
                    targetId: subject.id,
                    targetName: subject.name,
                    targetEmail: subject.email,
                    type: EVENT_TYPES[operation],
                    createdAt: NOW,
                }),
            ]);

            return;
        }

        await expectHttpError(OPERATIONS[operation](actor, subject.id), outcome);

        expect(await stateOf(subject)).toEqual(before);
        expect(await db.$count(adminEvents)).toBe(0);
    });

    it.each(['native', 'admin'] as const)(
        'o `can` de cada linha do painel, para quem vê como %s, é exatamente o que o serviço deixa fazer',
        async (viewer) => {
            const accounts = await world();
            const { users: rows } = await loadAdminPanel(accounts[viewer], {});

            for (const [who, target, outcomes] of HIERARCHY.filter(([who]) => who === viewer)) {
                const row = rows.find((candidate) => candidate.id === accounts[target].id);

                expect(row?.can, `${who} → ${target}`).toEqual(canOf(outcomes));
            }
        },
    );

    it('conta inexistente é 404 para quem administra — e 403 para quem não, sem revelar se ela existe', async () => {
        const native = await createNative();
        const admin = await createUser({ isAdmin: true });
        const user = await createUser();

        await expectHttpError(blockUser(native, 999_999), 404);
        await expectHttpError(grantAdmin(admin, 999_999), 404);
        await expectHttpError(blockUser(user, 999_999), 403);
        await expectHttpError(blockUser(user, admin.id), 403);
    });

    it('a recusa explica o motivo', async () => {
        const accounts = await world();
        const { native, admin, otherAdmin, user, blocked, pending } = accounts;
        const message = async (call: Promise<unknown>, status: 403 | 422) => (await expectHttpError(call, status)).message;

        expect(await message(blockUser(admin, admin.id), 403)).toBe('Você não pode alterar a própria conta pelo painel.');
        expect(await message(revokeAdmin(native, native.id), 403)).toBe(ADMIN_MESSAGES.self);
        expect(await message(grantAdmin(admin, user.id), 403)).toBe('Só o admin nativo pode conceder admin.');
        expect(await message(revokeAdmin(admin, otherAdmin.id), 403)).toBe(ADMIN_MESSAGES.nativeOnly.revoke_admin);
        expect(await message(blockUser(admin, otherAdmin.id), 403)).toBe(ADMIN_MESSAGES.nativeOnly.block);
        expect(await message(blockUser(admin, native.id), 403)).toBe(
            'Esta conta não pode ser bloqueada: o e-mail dela é de admin nativo.',
        );
        expect(await message(blockUser(native, pending.id), 403)).toBe(ADMIN_MESSAGES.nativeTarget.block);
        expect(await message(grantAdmin(native, pending.id), 403)).toBe(ADMIN_MESSAGES.nativeTarget.grant_admin);

        expect(await message(blockUser(native, blocked.id), 422)).toBe('Bia Bloqueada já está bloqueado(a).');
        expect(await message(unblockUser(native, user.id), 422)).toBe('Caio Comum não está bloqueado(a).');
        expect(await message(grantAdmin(native, admin.id), 422)).toBe('Ana Admin já é admin.');
        expect(await message(revokeAdmin(native, user.id), 422)).toBe('Caio Comum não é admin.');
        expect(await message(grantAdmin(native, blocked.id), 422)).toBe('Desbloqueie Bia Bloqueada antes de conceder admin.');

        expect(await message(grantAdmin(pending, user.id), 403)).toBe(ADMIN_MESSAGES.pending);
        expect(await message(blockUser(user, blocked.id), 403)).toBe('Você não tem permissão para fazer isso.');
    });

    it('bloquear um admin não tira o admin: ele só não entra — e volta como era ao ser desbloqueado', async () => {
        const native = await createNative();
        const admin = await createUser({ isAdmin: true });

        await blockUser(native, admin.id);

        const [blocked] = await db.select().from(users).where(eq(users.id, admin.id));

        expect(blocked).toMatchObject({ isAdmin: true, blockedAt: NOW, blockedBy: native.id });
        expect(adminAccess(blocked!)).toBeNull();

        await unblockUser(native, admin.id);

        const [unblocked] = await db.select().from(users).where(eq(users.id, admin.id));

        expect(unblocked).toMatchObject({ isAdmin: true, blockedAt: null, blockedBy: null });
        expect(adminAccess(unblocked!)).toBe('admin');
    });
});

describe('bloquear', () => {
    it('derruba todas as sessões da conta na hora — só as dela — e não mexe em quadros nem cards', async () => {
        const native = await createNative();
        const target = await createUser();
        const other = await createUser();
        const own = await createBoard(target);
        const card = await createCard(await createList(own));
        const shared = await createBoard(other);
        await addMember(shared, target);

        await openSession(target);
        await openSession(target, new Date(NOW.getTime() - 3_600_000));
        await openSession(other);

        await blockUser(native, target.id);

        expect(await db.$count(sessions, eq(sessions.userId, target.id))).toBe(0);
        expect(await db.$count(sessions, eq(sessions.userId, other.id))).toBe(1);

        // A conta continua existindo, com tudo o que era dela.
        expect(await db.$count(boards, eq(boards.id, own.id))).toBe(1);
        expect(await db.$count(cards, eq(cards.id, card.id))).toBe(1);
        expect(await db.$count(boardUser, eq(boardUser.userId, target.id))).toBe(2);
    });

    it('operação repetida (dois cliques, duas abas) não grava evento de novo nem troca quem bloqueou', async () => {
        const native = await createNative();
        const admin = await createUser({ isAdmin: true });
        const target = await createUser();

        // No PGlite as transações já entram em fila no driver (uma conexão só);
        // num Postgres de verdade, quem enfileira é a trava da linha do alvo
        // (`FOR NO KEY UPDATE`, em services/admin.ts). Aqui fica o contrato.
        const results = await Promise.allSettled([blockUser(native, target.id), blockUser(admin, target.id)]);

        expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
        expect(await db.$count(adminEvents)).toBe(1);

        const [event] = await db.select().from(adminEvents);

        expect((await stateOf(target))?.blockedBy).toBe(event?.actorId);

        await unblockUser(native, target.id);
        await expectHttpError(unblockUser(native, target.id), 422);
        await grantAdmin(native, target.id);
        await expectHttpError(grantAdmin(native, target.id), 422);
        await revokeAdmin(native, target.id);
        await expectHttpError(revokeAdmin(native, target.id), 422);

        expect(await db.$count(adminEvents)).toBe(4);
    });
});

describe('o histórico', () => {
    it('cada operação grava quem fez, o alvo copiado e a hora', async () => {
        const native = await createNative();
        const ana = await createUser({ name: 'Ana Souza', email: 'ana@taskon.test' });
        const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

        await grantAdmin(native, ana.id, at(1));
        await revokeAdmin(native, ana.id, at(2));
        await blockUser(native, ana.id, at(3));
        await unblockUser(native, ana.id, at(4));

        const rows = await db.select().from(adminEvents).orderBy(asc(adminEvents.id));
        const common = { actorId: native.id, targetId: ana.id, targetName: 'Ana Souza', targetEmail: 'ana@taskon.test' };

        expect(rows).toEqual([
            expect.objectContaining({ ...common, type: 'admin.granted', createdAt: at(1) }),
            expect.objectContaining({ ...common, type: 'admin.revoked', createdAt: at(2) }),
            expect.objectContaining({ ...common, type: 'user.blocked', createdAt: at(3) }),
            expect.objectContaining({ ...common, type: 'user.unblocked', createdAt: at(4) }),
        ]);
    });

    it('o painel mostra os mais recentes primeiro, com o nome de quem fez, até o limite', async () => {
        const native = await createNative();
        const target = await createUser({ name: 'Caio Comum', email: 'caio@taskon.test' });
        const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

        for (let round = 0; round < 12; round++) {
            await blockUser(native, target.id, at(round * 2));
            await unblockUser(native, target.id, at(round * 2 + 1));
        }

        const { events } = await loadAdminPanel(native, {});

        expect(events).toHaveLength(config.admin.eventsShown);
        expect(events[0]).toEqual({
            id: expect.any(Number),
            type: 'user.unblocked',
            actor: 'Victor Nativo',
            target_name: 'Caio Comum',
            target_email: 'caio@taskon.test',
            created_at: toAppIso(at(23)),
        });
        expect(events[1]).toMatchObject({ type: 'user.blocked', created_at: toAppIso(at(22)) });
        expect(events.at(-1)?.created_at).toBe(toAppIso(at(4)));
    });

    it('sobrevive à exclusão das contas: o alvo fica copiado e quem fez vira null', async () => {
        const native = await createNative();
        const admin = await createUser({ name: 'Ana Admin', isAdmin: true });
        const target = await createUser({ name: 'Caio Comum', email: 'caio@taskon.test' });

        await blockUser(admin, target.id);
        await db.delete(users).where(eq(users.id, admin.id));

        let panel = await loadAdminPanel(native, {});
        const row = panel.users.find((candidate) => candidate.id === target.id);

        // Quem bloqueou não existe mais (blocked_by → null), mas o bloqueio continua.
        expect(row).toMatchObject({ blocked_at: toAppIso(NOW), blocked_by: null });
        expect(panel.events[0]).toMatchObject({
            type: 'user.blocked',
            actor: null,
            target_name: 'Caio Comum',
            target_email: 'caio@taskon.test',
        });

        await db.delete(users).where(eq(users.id, target.id));
        panel = await loadAdminPanel(native, {});

        expect(panel.events[0]).toMatchObject({ target_name: 'Caio Comum', target_email: 'caio@taskon.test' });
    });
});

describe('o painel', () => {
    it('quem não administra recebe 404 — o painel não existe para ele, nem para o nativo pendente', async () => {
        const user = await createUser();
        const pending = await createUser({ email: NATIVE_EMAIL });
        const blockedAdmin = await createUser({ isAdmin: true, blockedAt: NOW });
        const admin = await createUser({ isAdmin: true });

        await expectHttpError(loadAdminPanel(user, {}), 404);
        await expectHttpError(loadAdminPanel(pending, {}), 404);
        await expectHttpError(loadAdminPanel(blockedAdmin, {}), 404);

        expect((await loadAdminPanel(admin, {})).viewer).toEqual({ access: 'admin' });
    });

    it('cada linha traz a última atividade, os quadros, o bloqueio e o papel', async () => {
        const native = await createNative({ createdAt: new Date('2026-01-05T12:00:00Z') });
        const ana = await createUser({
            name: 'Ana Souza',
            email: 'ana@taskon.test',
            avatarColor: 'rose',
            emailVerifiedAt: NOW,
            createdAt: new Date('2026-10-01T12:00:00Z'),
        });
        const bia = await createUser({ name: 'Bia Lima', email: 'bia@taskon.test' });

        await openSession(ana, new Date('2026-10-13T10:00:00Z'));
        await openSession(ana, new Date('2026-10-14T09:30:00Z'));
        await createBoard(ana);
        await addMember(await createBoard(native), ana);
        await blockUser(native, bia.id);

        const { viewer, users: rows } = await loadAdminPanel(native, {});
        const byId = (user: UserRow) => rows.find((row) => row.id === user.id);

        expect(viewer).toEqual({ access: 'native' });
        expect(byId(ana)).toEqual({
            id: ana.id,
            name: 'Ana Souza',
            email: 'ana@taskon.test',
            initials: 'AS',
            avatar_color: 'rose',
            created_at: '2026-10-01T09:00:00-03:00',
            last_seen_at: '2026-10-14T06:30:00-03:00',
            boards_count: 2,
            email_verified: true,
            role: 'user',
            blocked_at: null,
            blocked_by: null,
            can: { grant_admin: true, revoke_admin: false, block: true, unblock: false },
        });
        expect(byId(bia)).toMatchObject({
            last_seen_at: null,
            boards_count: 0,
            email_verified: false,
            blocked_at: toAppIso(NOW),
            blocked_by: 'Victor Nativo',
            can: { grant_admin: false, revoke_admin: false, block: false, unblock: true },
        });
        expect(byId(native)).toMatchObject({
            role: 'native',
            boards_count: 1,
            can: { grant_admin: false, revoke_admin: false, block: false, unblock: false },
        });
    });

    it('busca por nome e e-mail sem diferenciar maiúsculas, com % _ e \\ como texto', async () => {
        const native = await createNative();
        await createUser({ name: '100% Ana', email: 'cem@taskon.test' });
        await createUser({ name: 'Ana_Maria', email: 'ana.maria@taskon.test' });
        await createUser({ name: 'AnaXMaria', email: 'anax@taskon.test' });
        await createUser({ name: 'Barra\\Invertida', email: 'barra@taskon.test' });
        await createUser({ name: 'Zé', email: 'ze.ninguem@exemplo.test' });

        const search = async (q: string) => (await loadAdminPanel(native, { q })).users.map((row) => row.name).sort();

        expect(await search('ANA')).toEqual(['100% Ana', 'AnaXMaria', 'Ana_Maria']);
        expect(await search('%')).toEqual(['100% Ana']);
        expect(await search('_')).toEqual(['Ana_Maria']);
        expect(await search('Ana_M')).toEqual(['Ana_Maria']);
        expect(await search('\\')).toEqual(['Barra\\Invertida']);
        expect(await search('EXEMPLO.TEST')).toEqual(['Zé']);
        expect(await search('  zé  ')).toEqual(['Zé']);
        expect(await search('ninguém-tem-isso')).toEqual([]);
    });

    it('o termo chega aparado, sem caractere de controle e com até 100 caracteres', async () => {
        const native = await createNative();
        await createUser({ name: 'Bia Lima' });

        const term = async (q: string) => (await loadAdminPanel(native, { q })).filters.q;

        expect(await term(`   ${'x'.repeat(150)}   `)).toBe('x'.repeat(100));
        expect([...(await term('😀'.repeat(150)))]).toHaveLength(100);
        expect(await term('Bi\u0000a')).toBe('Bia');
        expect((await loadAdminPanel(native, { q: 'Bi\u0000a' })).users.map((row) => row.name)).toEqual(['Bia Lima']);
    });

    it('filtra por admins (concedidos e e-mails de nativo) e por bloqueados; filtro inválido vira "all"', async () => {
        const accounts = await world();
        const sorted = (values: number[]) => [...values].sort((a, b) => a - b);
        const ids = (...who: Who[]) => sorted(who.map((key) => accounts[key].id));
        const listed = async (filter: string) => {
            const panel = await loadAdminPanel(accounts.native, { filter });

            return {
                filter: panel.filters.filter,
                total: panel.pagination.total,
                ids: sorted(panel.users.map((row) => row.id)),
            };
        };

        expect(await listed('admins')).toEqual({
            filter: 'admins',
            total: 5,
            ids: ids('native', 'admin', 'otherAdmin', 'blockedAdmin', 'pending'),
        });
        expect(await listed('blocked')).toEqual({ filter: 'blocked', total: 2, ids: ids('blocked', 'blockedAdmin') });
        expect(await listed('qualquer-coisa')).toEqual({
            filter: 'all',
            total: 7,
            ids: ids('native', 'admin', 'otherAdmin', 'user', 'blocked', 'blockedAdmin', 'pending'),
        });

        // Busca e filtro juntos.
        const panel = await loadAdminPanel(accounts.native, { q: 'beto', filter: 'blocked' });

        expect(panel.users.map((row) => row.id)).toEqual([accounts.blockedAdmin.id]);
    });

    it('pagina de 25 em 25, mais nova primeiro; página inválida vira 1 e acima da última vira a última', async () => {
        const native = await createNative({ createdAt: new Date('2026-01-05T12:00:00Z') });

        for (let i = 1; i <= 30; i++) {
            await createUser({ name: `Conta ${i}`, createdAt: new Date(NOW.getTime() - i * 60_000) });
        }

        const page = (value: string | number | string[] | null | undefined) => loadAdminPanel(native, { page: value });

        const first = await page(undefined);

        expect(first.pagination).toEqual({ page: 1, per_page: 25, total: 31, pages: 2 });
        expect(first.users.map((row) => row.name).slice(0, 3)).toEqual(['Conta 1', 'Conta 2', 'Conta 3']);
        expect(first.users).toHaveLength(25);

        const second = await page('2');

        expect(second.pagination.page).toBe(2);
        expect(second.users.map((row) => row.name)).toEqual([
            'Conta 26',
            'Conta 27',
            'Conta 28',
            'Conta 29',
            'Conta 30',
            'Victor Nativo',
        ]);

        for (const invalid of ['0', '-1', 'abc', '1.5', '', ' ', null]) {
            expect((await page(invalid)).pagination.page, String(invalid)).toBe(1);
        }

        for (const beyond of ['3', '99', 99, '999999999999999999999']) {
            const result = await page(beyond);

            expect(result.pagination.page, String(beyond)).toBe(2);
            expect(result.users).toHaveLength(6);
        }

        expect((await page(2)).pagination.page).toBe(2);
        expect((await page(['2', '1'])).pagination.page).toBe(2);

        // Sem resultado nenhum: página 1 de 1, vazia.
        expect((await loadAdminPanel(native, { q: 'ninguém', page: '4' })).pagination).toEqual({
            page: 1,
            per_page: 25,
            total: 0,
            pages: 1,
        });
    });

    it('empate no instante de criação: a conta de id mais alto primeiro', async () => {
        const native = await createNative({ createdAt: new Date('2026-01-05T12:00:00Z') });
        const older = await createUser({ name: 'Gêmea A' });
        const newer = await createUser({ name: 'Gêmea B' });

        const { users: rows } = await loadAdminPanel(native, {});

        expect(rows.map((row) => row.id)).toEqual([newer.id, older.id, native.id]);
    });

    it('aceita o searchParams da página como ele chega (parâmetro repetido vira array)', async () => {
        const native = await createNative();
        // O tipo que as páginas do app dão ao `searchParams` (ver src/app/(guest)/login/page.tsx).
        const searchParams: Record<string, string | string[] | undefined> = {
            q: ['victor', 'outra'],
            filter: ['admins'],
            page: '1',
        };

        const panel = await loadAdminPanel(native, searchParams);

        expect(panel.filters).toEqual({ q: 'victor', filter: 'admins' });
        expect(panel.users.map((row) => row.id)).toEqual([native.id]);
    });

    it('os números do topo: contas, admins ativos, bloqueados, novos na semana, quadros e cards', async () => {
        const accounts = await world();

        // O e-mail nativo pendente não vira admin nem com is_admin ligado — vale a política.
        await db.update(users).set({ isAdmin: true }).where(eq(users.id, accounts.pending.id));

        await createUser({ name: 'Bem na fronteira', createdAt: new Date(NOW.getTime() - 7 * 86_400_000) });
        await createUser({ name: 'Antiga', createdAt: new Date(NOW.getTime() - 7 * 86_400_000 - 1000) });

        const board = await createBoard(accounts.user);
        await createBoard(accounts.admin);
        const list = await createList(board);
        await createCard(list);
        await createCard(list);
        await createCard(list, { archivedAt: NOW });

        const { stats } = await loadAdminPanel(accounts.admin, {}, NOW);

        expect(stats).toEqual({
            users: 9,
            // nativo confirmado + os dois concedidos; o admin bloqueado e o pendente ficam de fora
            admins: 3,
            blocked: 2,
            new_this_week: 8,
            boards: 2,
            cards: 3,
        });
    });
});

describe('as actions', () => {
    const ACTIONS = [grantAdminAction, revokeAdminAction, blockUserAction, unblockUserAction];

    it('sem sessão, 401 — e nada muda', async () => {
        const target = await createUser();

        for (const action of ACTIONS) {
            expect(await action({ userId: target.id })).toMatchObject({ ok: false, status: 401 });
        }

        expect(await db.$count(adminEvents)).toBe(0);
    });

    it('conta comum e nativo pendente recebem 403 com aviso, sem mexer em nada', async () => {
        const target = await createUser({ blockedAt: NOW });
        const user = await createUser();
        const pending = await createUser({ email: NATIVE_EMAIL });

        await signIn(user);

        for (const action of ACTIONS) {
            expect(await action({ userId: target.id })).toEqual({
                ok: false,
                status: 403,
                toast: { type: 'error', message: 'Você não tem permissão para fazer isso.' },
            });
        }

        await signIn(pending);

        expect(await unblockUserAction({ userId: target.id })).toEqual({
            ok: false,
            status: 403,
            toast: { type: 'error', message: ADMIN_MESSAGES.pending },
        });
        expect(await db.$count(adminEvents)).toBe(0);
        // A recusa também re-renderiza: quem perdeu o admin com o painel aberto
        // passa a ver o 404 no lugar dele (tests/regressions/admin-account-actions.test.ts).
        expect(refresh).toHaveBeenCalledTimes(ACTIONS.length + 1);
    });

    it('o nativo concede, tira, bloqueia e desbloqueia — com o aviso de cada uma e a tela atualizada', async () => {
        const native = await createNative();
        const ana = await createUser({ name: 'Ana Souza' });
        const success = (message: string) => ({ ok: true, data: null, toast: { type: 'success', message } });

        await signIn(native);

        expect(await grantAdminAction({ userId: ana.id })).toEqual(success('Agora Ana Souza é admin do Taskon.'));
        expect(await revokeAdminAction({ userId: ana.id })).toEqual(success('Ana Souza não é mais admin.'));
        expect(await blockUserAction({ userId: ana.id })).toEqual(
            success('Ana Souza foi bloqueado(a) — as sessões abertas caíram.'),
        );
        expect(await unblockUserAction({ userId: ana.id })).toEqual(success('Ana Souza foi desbloqueado(a).'));
        expect(refresh).toHaveBeenCalledTimes(4);
        expect(await db.$count(adminEvents)).toBe(4);
    });

    it('a recusa da hierarquia e a operação redundante voltam como toast — e com a tela atualizada', async () => {
        await createNative();
        const admin = await createUser({ isAdmin: true });
        const user = await createUser({ name: 'Caio Comum' });

        await signIn(admin);

        expect(await grantAdminAction({ userId: user.id })).toEqual({
            ok: false,
            status: 403,
            toast: { type: 'error', message: 'Só o admin nativo pode conceder admin.' },
        });
        expect(await blockUserAction({ userId: admin.id })).toMatchObject({
            ok: false,
            status: 403,
            toast: { message: 'Você não pode alterar a própria conta pelo painel.' },
        });
        expect(refresh).toHaveBeenCalledTimes(2);

        expect(await blockUserAction({ userId: user.id })).toMatchObject({ ok: true });
        expect(await blockUserAction({ userId: user.id })).toEqual({
            ok: false,
            status: 422,
            toast: { type: 'error', message: 'Caio Comum já está bloqueado(a).' },
        });
        // O sucesso e a recusa: a recusa redundante quer dizer que a tela estava
        // velha, e a linha volta com "Desbloquear" no lugar do "Bloquear".
        expect(refresh).toHaveBeenCalledTimes(4);
        expect(await db.$count(adminEvents)).toBe(1);
    });

    it('id inválido é 422 no campo; conta que não existe é 404 (e a tela atualiza)', async () => {
        const native = await createNative();

        await signIn(native);

        expect(await blockUserAction({ userId: 0 })).toMatchObject({
            ok: false,
            status: 422,
            errors: { userId: 'Identificador inválido.' },
        });
        expect(await blockUserAction({ userId: 'abc' as unknown as number })).toMatchObject({ ok: false, status: 422 });
        expect(await blockUserAction({ userId: 2_147_483_648 })).toMatchObject({ ok: false, status: 422 });
        expect(refresh).not.toHaveBeenCalled();

        expect(await blockUserAction({ userId: 999_999 })).toEqual({
            ok: false,
            status: 404,
            toast: { type: 'error', message: ADMIN_MESSAGES.notFound },
        });
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('bloquear pela action derruba as sessões da pessoa, não a de quem bloqueou', async () => {
        const native = await createNative();
        const target = await createUser();

        await openSession(target);
        await signIn(native);

        await blockUserAction({ userId: target.id });

        expect(await db.$count(sessions, eq(sessions.userId, target.id))).toBe(0);
        expect((await currentSession())?.user.id).toBe(native.id);
    });
});
