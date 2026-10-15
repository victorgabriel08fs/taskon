import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addAppDays } from '@/lib/timezone';
import { login } from '@/server/actions/auth';
import { updateDigestPreference } from '@/server/actions/notifications';
import { currentSession, currentUser, requireUser, startSession } from '@/server/auth/session';
import { db } from '@/server/db';
import { sessions, users, type UserRow } from '@/server/db/schema';
import { sentMail } from '@/server/mail/mailer';
import { AUTH_MESSAGES, authenticate, resetPassword, sendPasswordResetLink } from '@/server/services/auth';
import { runDailyDigest } from '@/server/services/daily-digest';
import { expectHttpError } from './support/assertions';
import { assign, createBoard, createCard, createList, createUser } from './support/factories';

/**
 * Conta bloqueada por um administrador: não entra, não tem sessão e não
 * recebe o resumo diário. Quem bloqueia (o painel /admin) é outro arquivo;
 * aqui fica o que o bloqueio impede — e o que ele NÃO revela: sem a senha
 * certa, o login responde como sempre.
 *
 * O bloqueio é gravado direto no banco, sem apagar as sessões como o painel
 * faz: assim o teste prova que o filtro da sessão segura sozinho.
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
    headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.7', 'user-agent': 'vitest' }),
}));
vi.mock('next/cache', () => ({ refresh: vi.fn() }));

/** Segunda-feira, 12/10/2026, 10:00 em São Paulo. */
const NOW = new Date('2026-10-12T13:00:00Z');
const IP = '203.0.113.7';

beforeEach(() => {
    jar.store.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
});

afterEach(() => {
    vi.useRealTimers();
});

async function block(user: Pick<UserRow, 'id'>): Promise<void> {
    await db.update(users).set({ blockedAt: new Date() }).where(eq(users.id, user.id));
}

async function unblock(user: Pick<UserRow, 'id'>): Promise<void> {
    await db.update(users).set({ blockedAt: null, blockedBy: null }).where(eq(users.id, user.id));
}

async function reload(user: Pick<UserRow, 'id'>): Promise<UserRow> {
    const [row] = await db.select().from(users).where(eq(users.id, user.id));

    return row!;
}

/** Para onde a chamada redirecionou (o `assertRedirect`), ou null. */
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

/** O token do último e-mail de redefinição de senha. */
function lastResetToken(): string {
    const text = sentMail.at(-1)?.text ?? '';
    const match = /\/reset-password\/([A-Za-z0-9_-]+)\?email=/.exec(text);

    if (!match?.[1]) throw new Error(`nenhum link de redefinição no e-mail: ${text}`);

    return match[1];
}

/** Um card vencido ontem, atribuído à pessoa num quadro dela — assunto para o resumo. */
async function overdueCardFor(user: UserRow): Promise<void> {
    const list = await createList(await createBoard(user));
    const card = await createCard(list, { dueAt: addAppDays(NOW, -1) });

    await assign(card, user);
}

describe('login de conta bloqueada', () => {
    it('com a senha certa, a resposta é o bloqueio — no campo e-mail', async () => {
        const user = await createUser({ blockedAt: NOW });

        const error = await expectHttpError(authenticate({ email: user.email, password: 'password' }, IP), 422, 'email');

        expect(error.errors?.email).toBe('Esta conta foi bloqueada por um administrador do Taskon.');
        expect(AUTH_MESSAGES.blocked).toBe(error.errors?.email);
    });

    it('com a senha errada, a mensagem é a de sempre e o erro conta no limite', async () => {
        const user = await createUser({ blockedAt: NOW });

        for (let attempt = 1; attempt <= 5; attempt++) {
            const error = await expectHttpError(authenticate({ email: user.email, password: 'errada' }, IP), 422, 'email');

            expect(error.errors?.email).toBe(AUTH_MESSAGES.failed);
        }

        // A 6ª esbarra no limite mesmo com a senha certa — e o bloqueio continua sem aparecer.
        const throttled = await expectHttpError(authenticate({ email: user.email, password: 'password' }, IP), 422, 'email');

        expect(throttled.errors?.email).toMatch(/^Muitas tentativas de login\. Tente de novo em \d+ segundos?\.$/);
    });

    it('pela action: erro no e-mail, nenhuma sessão aberta e nenhum "bem-vindo"', async () => {
        const user = await createUser({ blockedAt: NOW });

        expect(await login({ email: user.email, password: 'password', remember: false })).toEqual({
            ok: false,
            status: 422,
            errors: { email: AUTH_MESSAGES.blocked },
        });
        expect(jar.store.has('taskon_session')).toBe(false);
        expect(jar.store.has('taskon_flash')).toBe(false);
        expect(await db.$count(sessions)).toBe(0);
    });

    it('desbloqueada, entra de novo', async () => {
        const user = await createUser({ blockedAt: NOW });

        await unblock(user);

        await expect(authenticate({ email: user.email, password: 'password' }, IP)).resolves.toMatchObject({ id: user.id });
    });

    it('"Esqueci a senha" continua funcionando sem revelar o bloqueio — e o login segue recusado', async () => {
        const user = await createUser({ blockedAt: NOW });

        expect(await sendPasswordResetLink(user.email, IP)).toEqual({ status: AUTH_MESSAGES.resetLinkSent });

        await resetPassword({ token: lastResetToken(), email: user.email, password: 'nova-senha-123' });

        const error = await expectHttpError(
            authenticate({ email: user.email, password: 'nova-senha-123' }, IP),
            422,
            'email',
        );

        expect(error.errors?.email).toBe(AUTH_MESSAGES.blocked);
    });
});

describe('sessão de conta bloqueada', () => {
    it('currentSession ignora a sessão, mesmo com o cookie e a linha válidos', async () => {
        const user = await createUser();

        await startSession(user.id, false);
        expect((await currentSession())?.user.id).toBe(user.id);

        await block(user);

        expect(jar.store.has('taskon_session')).toBe(true);
        expect(await db.$count(sessions, eq(sessions.userId, user.id))).toBe(1);
        expect(await currentSession()).toBeNull();
        expect(await currentUser()).toBeNull();
    });

    it('as páginas mandam para o login e as actions respondem 401', async () => {
        const user = await createUser({ dailyDigest: true });

        await startSession(user.id, false);
        await block(user);

        expect(await redirectOf(requireUser())).toBe('/login');
        expect(await updateDigestPreference({ daily_digest: false })).toMatchObject({ ok: false, status: 401 });
        expect((await reload(user)).dailyDigest).toBe(true);
    });
});

describe('resumo diário', () => {
    it('não vai para conta bloqueada', async () => {
        const active = await createUser();
        const blocked = await createUser({ blockedAt: NOW });

        await overdueCardFor(active);
        await overdueCardFor(blocked);

        const result = await runDailyDigest();

        expect(result).toMatchObject({ sent: 1, skipped: 0, failed: 0 });
        expect(sentMail.map((mail) => mail.to)).toEqual([active.email]);
        expect(result.lines.join('\n')).not.toContain(blocked.email);
    });

    it('nem com --force, nem escolhida pelo --user', async () => {
        const blocked = await createUser({ blockedAt: NOW });

        await overdueCardFor(blocked);

        expect(await runDailyDigest({ force: true })).toMatchObject({ sent: 0, failed: 0 });
        expect(await runDailyDigest({ force: true, user: blocked.id })).toMatchObject({ sent: 0 });
        expect(await runDailyDigest({ force: true, user: blocked.email })).toMatchObject({ sent: 0 });
        expect(await runDailyDigest({ force: true, dryRun: true })).toMatchObject({ sent: 0 });
        expect(sentMail).toHaveLength(0);
        expect((await reload(blocked)).digestLastSentAt).toBeNull();
    });

    it('desbloqueada, volta a receber', async () => {
        const user = await createUser({ blockedAt: NOW });

        await overdueCardFor(user);
        await unblock(user);

        expect(await runDailyDigest()).toMatchObject({ sent: 1 });
        expect(sentMail[0]?.to).toBe(user.email);
    });
});
