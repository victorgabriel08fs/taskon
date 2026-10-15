import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blockUser as blockUserAction, grantAdmin as grantAdminAction } from '@/server/actions/admin';
import { login, resetPassword as resetPasswordAction } from '@/server/actions/auth';
import { currentSession, requireUser, startSession } from '@/server/auth/session';
import { config } from '@/server/config';
import { db } from '@/server/db';
import { adminEvents, sessions, users, type UserRow } from '@/server/db/schema';
import { sentMail } from '@/server/mail/mailer';
import { adminAccess, adminCan } from '@/server/policies/admin';
import { loadAdminPanel } from '@/server/queries/admin';
import { AUTH_MESSAGES, registerUser, sendPasswordResetLink } from '@/server/services/auth';
import { blockUser, grantAdmin, revokeAdmin, unblockUser } from '@/server/services/admin';
import { expectHttpError } from '../support/assertions';
import { createUser } from '../support/factories';

/**
 * Revisão (lente: testes) — as células da hierarquia e as consequências do
 * bloqueio que a suíte original não exercita:
 *
 *  - um SEGUNDO nativo já confirmado (NATIVE_ADMIN_EMAILS com dois endereços)
 *    é intocável até para o primeiro nativo;
 *  - conta de e-mail nativo bloqueada por fora não é desbloqueável pelo painel;
 *  - "ela cai na hora": o navegador da pessoa bloqueada, com o cookie ainda
 *    lá, deixa de ter sessão na requisição seguinte — e o desbloqueio não
 *    ressuscita sessões;
 *  - o admin que perdeu o admin (ou foi bloqueado) para de administrar na
 *    requisição seguinte, sem precisar sair e entrar;
 *  - quem ocupou o e-mail do nativo perde a conta para o dono pela
 *    redefinição de senha;
 *  - "Esqueci a senha" de conta bloqueada não revela o bloqueio pelas actions.
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
    headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.41', 'user-agent': 'vitest' }),
}));
vi.mock('next/cache', () => ({ refresh: vi.fn() }));

const NOW = new Date('2026-10-14T15:00:00Z');
const IP = '203.0.113.41';
const NATIVE_EMAIL = config.admin.nativeEmails[0]!;
const SECOND_NATIVE_EMAIL = 'segunda-nativa@taskon.test';
const ORIGINAL_NATIVE_EMAILS = [...config.admin.nativeEmails];

const NOTHING = { grant_admin: false, revoke_admin: false, block: false, unblock: false };
const OPERATIONS = [grantAdmin, revokeAdmin, blockUser, unblockUser];

beforeEach(() => {
    jar.store.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
});

afterEach(() => {
    vi.useRealTimers();
    config.admin.nativeEmails.splice(0, config.admin.nativeEmails.length, ...ORIGINAL_NATIVE_EMAILS);
});

async function reload(user: Pick<UserRow, 'id'>): Promise<UserRow> {
    const [row] = await db.select().from(users).where(eq(users.id, user.id));

    return row!;
}

/** O cookie de sessão que está no "navegador" agora. */
const cookie = () => jar.store.get('taskon_session');

/** Para onde a chamada redirecionou, ou null. */
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

function lastResetToken(): string {
    const match = /\/reset-password\/([A-Za-z0-9_-]+)\?email=/.exec(sentMail.at(-1)?.text ?? '');

    if (!match?.[1]) throw new Error('nenhum link de redefinição no e-mail');

    return match[1];
}

describe('e-mail nativo é intocável', () => {
    it('um segundo nativo confirmado: nem o primeiro nativo nem um admin mexem nele', async () => {
        config.admin.nativeEmails.push(SECOND_NATIVE_EMAIL);

        const native = await createUser({ name: 'Nativo Um', email: NATIVE_EMAIL, emailVerifiedAt: NOW });
        const other = await createUser({ name: 'Nativa Dois', email: SECOND_NATIVE_EMAIL, emailVerifiedAt: NOW });
        const admin = await createUser({ isAdmin: true });

        expect(adminAccess(other)).toBe('native');

        for (const viewer of [native, admin]) {
            expect(adminCan(viewer, other)).toEqual(NOTHING);

            for (const operation of OPERATIONS) await expectHttpError(operation(viewer, other.id), 403);
        }

        const row = (await loadAdminPanel(native, {})).users.find((candidate) => candidate.id === other.id);

        expect(row).toMatchObject({ role: 'native', can: NOTHING });
        expect(await db.$count(adminEvents)).toBe(0);
        expect(await reload(other)).toMatchObject({ isAdmin: false, blockedAt: null });
    });

    it('conta de e-mail nativo bloqueada por fora não é desbloqueada (nem promovida) pelo painel', async () => {
        const native = await createUser({ email: NATIVE_EMAIL, emailVerifiedAt: NOW });

        config.admin.nativeEmails.push(SECOND_NATIVE_EMAIL);

        const squatter = await createUser({ email: SECOND_NATIVE_EMAIL, blockedAt: NOW });

        expect(adminAccess(squatter)).toBeNull();
        expect(adminCan(native, squatter)).toEqual(NOTHING);
        await expectHttpError(unblockUser(native, squatter.id), 403);
        await expectHttpError(grantAdmin(native, squatter.id), 403);
        expect((await reload(squatter)).blockedAt).toEqual(NOW);
    });
});

describe('o bloqueio derruba a pessoa na hora', () => {
    it('o navegador da pessoa, com o cookie ainda guardado, já chega como visitante', async () => {
        const native = await createUser({ email: NATIVE_EMAIL, emailVerifiedAt: NOW });
        const target = await createUser();

        await startSession(target.id, true);
        const browserCookie = cookie();

        expect((await currentSession())?.user.id).toBe(target.id);

        // O nativo bloqueia de outro navegador (o serviço, sem tocar neste pote de cookies).
        await blockUser(native, target.id);

        expect(cookie()).toEqual(browserCookie);
        expect(await currentSession()).toBeNull();
        expect(await redirectOf(requireUser())).toBe('/login');

        // Desbloquear não ressuscita a sessão derrubada: precisa entrar de novo.
        await unblockUser(native, target.id);

        expect(await currentSession()).toBeNull();
        expect(await redirectOf(login({ email: target.email, password: 'password', remember: false }))).toBe(
            '/dashboard',
        );
        expect((await currentSession())?.user.id).toBe(target.id);
    });

    it('bloqueada pelo painel (a action), a pessoa não entra mais — nem com a senha certa', async () => {
        const native = await createUser({ email: NATIVE_EMAIL, emailVerifiedAt: NOW });
        const target = await createUser();

        await startSession(native.id, false);
        expect(await blockUserAction({ userId: target.id })).toMatchObject({ ok: true });

        jar.store.clear();

        expect(await login({ email: target.email, password: 'password', remember: false })).toEqual({
            ok: false,
            status: 422,
            errors: { email: AUTH_MESSAGES.blocked },
        });
        expect(await db.$count(sessions, eq(sessions.userId, target.id))).toBe(0);
    });

    it('admin bloqueado no meio do expediente: a próxima action dele é 401, e nada muda', async () => {
        const native = await createUser({ email: NATIVE_EMAIL, emailVerifiedAt: NOW });
        const admin = await createUser({ isAdmin: true });
        const victim = await createUser();

        await startSession(admin.id, false);
        await blockUser(native, admin.id);

        expect(await blockUserAction({ userId: victim.id })).toMatchObject({ ok: false, status: 401 });
        expect((await reload(victim)).blockedAt).toBeNull();

        // Mesmo com uma sessão gravada depois do bloqueio (um login que corria junto).
        await db.insert(sessions).values({
            id: randomBytes(32).toString('hex'),
            userId: admin.id,
            lastActivityAt: NOW,
            expiresAt: new Date(NOW.getTime() + 86_400_000),
        });
        await expectHttpError(loadAdminPanel(await reload(admin), {}), 404);
    });

    it('tirar o admin vale na próxima requisição da sessão aberta do ex-admin', async () => {
        const native = await createUser({ email: NATIVE_EMAIL, emailVerifiedAt: NOW });
        const admin = await createUser({ isAdmin: true });
        const victim = await createUser();

        await startSession(admin.id, false);
        await revokeAdmin(native, admin.id);

        expect(await blockUserAction({ userId: victim.id })).toMatchObject({ ok: false, status: 403 });
        expect(await grantAdminAction({ userId: victim.id })).toMatchObject({ ok: false, status: 403 });
        expect((await reload(victim)).blockedAt).toBeNull();
        expect(await db.$count(adminEvents)).toBe(1);
    });
});

describe('quem ocupou o e-mail do nativo', () => {
    it('perde a conta para o dono pela redefinição de senha: sessões caem e o nativo ativa', async () => {
        const squatter = await registerUser(
            { name: 'Impostor', email: NATIVE_EMAIL, password: 'senha-do-impostor' },
            '198.51.100.9',
        );

        await startSession(squatter.id, true);
        expect(adminAccess(squatter)).toBe('pending');

        // O dono de verdade, em outro navegador: o link chega só na caixa dele.
        jar.store.clear();
        await sendPasswordResetLink(NATIVE_EMAIL, IP);

        expect(
            await redirectOf(
                resetPasswordAction({
                    token: lastResetToken(),
                    email: NATIVE_EMAIL,
                    password: 'senha-do-dono',
                    password_confirmation: 'senha-do-dono',
                }),
            ),
        ).toBe('/login');

        expect(await db.$count(sessions, eq(sessions.userId, squatter.id))).toBe(0);
        expect(adminAccess(await reload(squatter))).toBe('native');
        expect(await db.select({ type: adminEvents.type, actorId: adminEvents.actorId }).from(adminEvents)).toEqual([
            { type: 'admin.activated', actorId: squatter.id },
        ]);
        expect(await redirectOf(login({ email: NATIVE_EMAIL, password: 'senha-do-dono', remember: false }))).toBe(
            '/dashboard',
        );

        // A ativação aparece no histórico do painel, com a própria conta como autora.
        const { events } = await loadAdminPanel(await reload(squatter), {});

        expect(events).toEqual([
            expect.objectContaining({
                type: 'admin.activated',
                actor: 'Impostor',
                target_name: 'Impostor',
                target_email: NATIVE_EMAIL,
            }),
        ]);
    });
});

describe('"Esqueci a senha" de conta bloqueada, pelas actions', () => {
    it('a redefinição termina como qualquer outra; o bloqueio só aparece no login com a senha certa', async () => {
        const blocked = await createUser({ blockedAt: NOW });

        await sendPasswordResetLink(blocked.email, IP);

        expect(
            await redirectOf(
                resetPasswordAction({
                    token: lastResetToken(),
                    email: blocked.email,
                    password: 'nova-senha-123',
                    password_confirmation: 'nova-senha-123',
                }),
            ),
        ).toBe('/login');
        expect(jar.store.get('taskon_status')).toContain('Sua senha foi redefinida. Entre com a nova senha.');

        expect(await login({ email: blocked.email, password: 'errada', remember: false })).toEqual({
            ok: false,
            status: 422,
            errors: { email: AUTH_MESSAGES.failed },
        });
        expect(await login({ email: blocked.email, password: 'nova-senha-123', remember: false })).toEqual({
            ok: false,
            status: 422,
            errors: { email: AUTH_MESSAGES.blocked },
        });
        expect(jar.store.has('taskon_session')).toBe(false);
    });
});
