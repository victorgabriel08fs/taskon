import { count, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { login, logout, register } from '@/server/actions/auth';
import { currentSession, startSession } from '@/server/auth/session';
import { db } from '@/server/db';
import { boardUser, cards, sessions, users } from '@/server/db/schema';
import { createUser } from '../support/factories';

/**
 * Paridade com tests/Feature/Auth/AuthenticationTest.php e RegistrationTest.php
 * no nível da Server Action (o POST /login, /register e /logout do Laravel).
 *
 * Só o `next/headers` é dublê: um pote de cookies em memória e os cabeçalhos
 * da requisição. A sessão (startSession/currentSession/endSession), o flash e
 * o banco são os de verdade — `assertAuthenticatedAs` vira "o cookie gravado
 * pela action abre uma sessão válida desta pessoa".
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
    headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.9', 'user-agent': 'vitest' }),
}));
vi.mock('next/cache', () => ({ refresh: vi.fn() }));

/** Para onde a action redirecionou (o `assertRedirect`), ou null. */
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

beforeEach(() => {
    jar.store.clear();
});

describe('AuthenticationTest', () => {
    it('test_users_can_authenticate: entra, vai para o painel e fica autenticado como a pessoa', async () => {
        const user = await createUser();

        expect(await redirectOf(login({ email: user.email, password: 'password', remember: false }))).toBe('/dashboard');

        // assertAuthenticatedAs($user)
        expect((await currentSession())?.user.id).toBe(user.id);
    });

    it('test_users_cannot_authenticate_with_invalid_password: erro em email e continua visitante', async () => {
        const user = await createUser();

        const result = await login({ email: user.email, password: 'senha-errada', remember: false });

        expect(result).toMatchObject({ ok: false, status: 422 });
        expect(result.ok ? null : result.errors?.email).toBeTruthy();

        // assertGuest()
        expect(await currentSession()).toBeNull();
        expect(await db.$count(sessions)).toBe(0);
    });

    it('test_users_can_logout: sai, vai para "/" e vira visitante', async () => {
        const user = await createUser();

        await startSession(user.id, false);
        expect((await currentSession())?.user.id).toBe(user.id);

        expect(await redirectOf(logout())).toBe('/');

        expect(await currentSession()).toBeNull();
        expect(await db.$count(sessions, eq(sessions.userId, user.id))).toBe(0);
    });
});

describe('RegistrationTest', () => {
    it('test_new_users_can_register_and_get_a_starter_board', async () => {
        const target = await redirectOf(
            register({
                name: 'Victor',
                email: 'victor@example.com',
                password: 'senha-super-secreta',
                password_confirmation: 'senha-super-secreta',
            }),
        );

        expect(target).toBe('/dashboard');

        // assertAuthenticated()
        const session = await currentSession();

        expect(session?.user.email).toBe('victor@example.com');

        const [user] = await db.select().from(users).where(eq(users.email, 'victor@example.com'));

        expect(user).toBeDefined();

        const memberships = await db.select().from(boardUser).where(eq(boardUser.userId, user!.id));

        expect(memberships, 'A conta nova deve nascer com um quadro de exemplo.').toHaveLength(1);

        const [cardTotal] = await db.select({ n: count() }).from(cards).where(eq(cards.boardId, memberships[0]!.boardId));

        expect(cardTotal?.n).toBeGreaterThan(0);
    });

    it('test_email_must_be_unique', async () => {
        await createUser({ email: 'ocupado@example.com' });

        const result = await register({
            name: 'Outro',
            email: 'ocupado@example.com',
            password: 'senha-super-secreta',
            password_confirmation: 'senha-super-secreta',
        });

        expect(result).toMatchObject({ ok: false, status: 422 });
        expect(result.ok ? null : result.errors?.email).toBeTruthy();
        expect(await currentSession()).toBeNull();
    });
});
