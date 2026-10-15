import { eq } from 'drizzle-orm';
import { refresh } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { confirmEmail, requestEmailVerification } from '@/server/actions/email-verification';
import { config } from '@/server/config';
import { db } from '@/server/db';
import { adminEvents, emailVerifications, users, type UserRow } from '@/server/db/schema';
import { emailVerificationMail } from '@/server/mail/email-verification';
import { sentMail } from '@/server/mail/mailer';
import { adminAccess } from '@/server/policies/admin';
import { resetPassword, sendPasswordResetLink } from '@/server/services/auth';
import {
    EMAIL_VERIFICATION_MESSAGES,
    confirmEmailVerification,
    markEmailVerified,
    previewEmailVerification,
    pruneExpiredEmailVerifications,
    sendEmailVerification,
} from '@/server/services/email-verification';
import { updateProfile } from '@/server/services/profile';
import { expectHttpError } from './support/assertions';
import { createUser } from './support/factories';

/**
 * A confirmação de e-mail: pedir o link, abrir, confirmar, e as travas — o
 * prazo, o uso único, o e-mail trocado no meio do caminho e o intervalo entre
 * pedidos. E o que ela ativa: o admin nativo, por este link ou pela
 * redefinição de senha concluída (os dois provam a caixa de entrada).
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
    headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.7', 'user-agent': 'vitest' }),
}));
vi.mock('next/cache', () => ({ refresh: vi.fn() }));

const NOW = new Date('2026-10-13T15:00:00Z');
const IP = '203.0.113.7';

/**
 * O endereço de admin nativo desta execução. Lido da config, e não escrito
 * aqui, para o teste valer com qualquer `NATIVE_ADMIN_EMAILS` no ambiente.
 */
const NATIVE_EMAIL = config.admin.nativeEmails[0]!;

beforeEach(() => {
    jar.store.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

/** Avança o relógio para `seconds` depois de NOW. */
function at(seconds: number): void {
    vi.setSystemTime(new Date(NOW.getTime() + seconds * 1000));
}

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

/** O token cru só existe no e-mail — como na vida real, ele sai de lá. */
function lastToken(): string {
    const text = sentMail.at(-1)?.text ?? '';
    const match = /\/verify-email\/([A-Za-z0-9_-]+)/.exec(text);

    if (!match?.[1]) throw new Error(`nenhum link de confirmação no e-mail: ${text}`);

    return match[1];
}

/** O token do último e-mail de redefinição de senha. */
function lastResetToken(): string {
    const text = sentMail.at(-1)?.text ?? '';
    const match = /\/reset-password\/([A-Za-z0-9_-]+)\?email=/.exec(text);

    if (!match?.[1]) throw new Error(`nenhum link de redefinição no e-mail: ${text}`);

    return match[1];
}

async function requestToken(user: UserRow): Promise<string> {
    await sendEmailVerification(user);

    return lastToken();
}

async function reload(user: Pick<UserRow, 'id'>): Promise<UserRow> {
    const [row] = await db.select().from(users).where(eq(users.id, user.id));

    return row!;
}

/** Loga a pessoa no pote de cookies, como se ela tivesse entrado pelo formulário. */
async function signIn(user: UserRow) {
    const { startSession } = await import('@/server/auth/session');

    await startSession(user.id, false);
}

describe('pedir o link', () => {
    it('manda o link para o e-mail da conta e guarda só o hash do token', async () => {
        const user = await createUser({ name: 'Ana Souza', email: 'ana@example.com' });

        expect(await sendEmailVerification(user)).toEqual({ email: 'ana@example.com' });
        expect(sentMail).toHaveLength(1);

        const mail = sentMail[0]!;

        expect(mail).toMatchObject({ to: 'ana@example.com', toName: 'Ana Souza' });
        expect(mail.subject).toBe('Confirme seu e-mail no Taskon');
        expect(mail.html).toContain('Olá, Ana.');
        expect(mail.html).toContain('24 horas');
        expect(mail.text).toContain('http://taskon.test/verify-email/');

        const token = lastToken();
        const [stored] = await db.select().from(emailVerifications);

        expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(stored).toMatchObject({ userId: user.id, email: 'ana@example.com', createdAt: NOW });
        expect(stored?.token).toMatch(/^[0-9a-f]{64}$/);
        expect(stored?.token).not.toBe(token);
    });

    it('pedir de novo troca o link: o anterior para de valer', async () => {
        const user = await createUser();
        const first = await requestToken(user);

        at(61);
        const second = await requestToken(user);

        expect(second).not.toBe(first);
        expect(await previewEmailVerification(first)).toBeNull();
        expect(await previewEmailVerification(second)).not.toBeNull();
        expect(await db.$count(emailVerifications)).toBe(1);
    });

    it('um link por minuto por conta — sem travar as outras contas', async () => {
        const user = await createUser();
        await sendEmailVerification(user);

        const immediate = await expectHttpError(sendEmailVerification(user), 429);

        expect(immediate.message).toBe(EMAIL_VERIFICATION_MESSAGES.throttled(60));

        at(30);
        const later = await expectHttpError(sendEmailVerification(user), 429);

        expect(later.message).toContain('em 30 segundos');
        expect(sentMail).toHaveLength(1);

        await sendEmailVerification(await createUser());
        expect(sentMail).toHaveLength(2);

        at(61);
        await sendEmailVerification(user);
        expect(sentMail).toHaveLength(3);
    });

    it('no máximo cinco links por hora por conta', async () => {
        const user = await createUser();

        for (let i = 0; i < 5; i++) {
            at(i * 61);
            await sendEmailVerification(user);
        }

        at(5 * 61);
        const capped = await expectHttpError(sendEmailVerification(user), 429);

        // Em minutos: "3295 segundos" não diz nada a ninguém.
        expect(capped.message).toBe(EMAIL_VERIFICATION_MESSAGES.hourly(55));
        expect(sentMail).toHaveLength(5);

        // A janela é de uma hora a partir do primeiro pedido.
        at(3601);
        await sendEmailVerification(user);
        expect(sentMail).toHaveLength(6);
    });

    it('se o e-mail não sai, nada muda — o link que a pessoa já tem continua valendo', async () => {
        const user = await createUser();
        const first = await requestToken(user);

        at(61);
        vi.spyOn(console, 'error').mockImplementation(() => {});

        // Resend sem chave: o mailer lança antes de qualquer chamada de rede.
        vi.stubEnv('MAIL_MAILER', 'resend');
        vi.stubEnv('RESEND_API_KEY', '');

        const error = await expectHttpError(sendEmailVerification(user), 500);

        expect(error.message).toBe(EMAIL_VERIFICATION_MESSAGES.mailFailed);

        vi.unstubAllEnvs();

        expect(await previewEmailVerification(first)).not.toBeNull();
        expect(await db.select().from(emailVerifications)).toEqual([expect.objectContaining({ createdAt: NOW })]);

        // O intervalo conta do link que chegou, então a pessoa pede de novo na hora.
        await sendEmailVerification(user);
        expect(sentMail).toHaveLength(2);
    });

    it('sem pedido anterior, a falha no envio não deixa registro', async () => {
        const user = await createUser();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.stubEnv('MAIL_MAILER', 'resend');
        vi.stubEnv('RESEND_API_KEY', '');

        await expectHttpError(sendEmailVerification(user), 500);

        expect(await db.$count(emailVerifications)).toBe(0);
    });
});

describe('confirmar pelo link', () => {
    it('a prévia mostra a conta, e confirmar marca o e-mail — uma vez só', async () => {
        const user = await createUser({ name: 'Ana Souza', email: 'ana@example.com' });
        const token = await requestToken(user);

        expect(await previewEmailVerification(token)).toEqual({ email: 'ana@example.com', name: 'Ana Souza' });
        expect(await confirmEmailVerification(token)).toEqual({ userId: user.id, becameNativeAdmin: false });
        expect((await reload(user)).emailVerifiedAt).toEqual(NOW);
        expect(await db.$count(emailVerifications)).toBe(0);

        expect(await previewEmailVerification(token)).toBeNull();

        const again = await expectHttpError(confirmEmailVerification(token), 404);

        expect(again.message).toBe(EMAIL_VERIFICATION_MESSAGES.invalid);
    });

    it('vale até o fim do prazo', async () => {
        const user = await createUser();
        const token = await requestToken(user);

        at(config.admin.emailVerificationMinutes * 60 - 60);

        expect(await previewEmailVerification(token)).not.toBeNull();
        expect(await confirmEmailVerification(token)).toMatchObject({ userId: user.id });
    });

    it('link vencido não confirma nada, e a faxina noturna o apaga', async () => {
        const user = await createUser();
        const token = await requestToken(user);

        at(config.admin.emailVerificationMinutes * 60 + 1);
        const fresh = await requestToken(await createUser());

        expect(await previewEmailVerification(token)).toBeNull();
        await expectHttpError(confirmEmailVerification(token), 404);
        expect((await reload(user)).emailVerifiedAt).toBeNull();

        await pruneExpiredEmailVerifications();

        expect(await db.$count(emailVerifications)).toBe(1);
        expect(await previewEmailVerification(fresh)).not.toBeNull();
    });

    it('trocar o e-mail no meio do caminho mata o link — e quem herda o endereço não herda o link', async () => {
        const ana = await createUser({ email: 'ana@example.com' });
        const token = await requestToken(ana);

        await updateProfile(ana, { name: ana.name, email: 'ana.nova@example.com', title: null, avatar_color: 'violet' });

        expect(await previewEmailVerification(token)).toBeNull();
        await expectHttpError(confirmEmailVerification(token), 404);

        const bia = await createUser({ email: 'bia@example.com' });
        await updateProfile(bia, { name: bia.name, email: 'ana@example.com', title: null, avatar_color: 'violet' });

        expect(await previewEmailVerification(token)).toBeNull();
        await expectHttpError(confirmEmailVerification(token), 404);
        expect((await reload(ana)).emailVerifiedAt).toBeNull();
        expect((await reload(bia)).emailVerifiedAt).toBeNull();
    });

    it('token inventado ou fora do formato não abre nada', async () => {
        await requestToken(await createUser());

        expect(await previewEmailVerification('inventado')).toBeNull();
        expect(await previewEmailVerification('x'.repeat(43))).toBeNull();
        await expectHttpError(confirmEmailVerification('x'.repeat(43)), 404);
        await expectHttpError(confirmEmailVerification(''), 404);
        expect(await db.$count(emailVerifications)).toBe(1);
    });
});

describe('o admin nativo', () => {
    async function eventsOf(user: Pick<UserRow, 'id'>) {
        return db.select().from(adminEvents).where(eq(adminEvents.targetId, user.id));
    }

    it('confirmar o e-mail nativo ativa a administração e fica no histórico', async () => {
        const native = await createUser({ name: 'Victor Gabriel', email: NATIVE_EMAIL });

        expect(adminAccess(native)).toBe('pending');

        const token = await requestToken(native);

        expect(sentMail[0]?.to).toBe(NATIVE_EMAIL);
        expect(await confirmEmailVerification(token)).toEqual({ userId: native.id, becameNativeAdmin: true });
        expect(adminAccess(await reload(native))).toBe('native');
        expect(await eventsOf(native)).toEqual([
            expect.objectContaining({
                type: 'admin.activated',
                actorId: native.id,
                targetId: native.id,
                targetName: 'Victor Gabriel',
                targetEmail: NATIVE_EMAIL,
                createdAt: NOW,
            }),
        ]);
    });

    it('concluir a redefinição de senha também ativa — o link chegou na caixa de entrada', async () => {
        const native = await createUser({ name: 'Victor Gabriel', email: NATIVE_EMAIL });

        await sendPasswordResetLink(native.email, IP);

        const updated = await resetPassword({ token: lastResetToken(), email: native.email, password: 'nova-senha-123' });

        expect(updated.emailVerifiedAt).toEqual(NOW);
        expect(adminAccess(updated)).toBe('native');
        expect(await eventsOf(native)).toEqual([
            expect.objectContaining({ type: 'admin.activated', actorId: native.id, targetId: native.id }),
        ]);
    });

    it('já confirmado, confirmar de novo não registra outra ativação nem mexe na data', async () => {
        const confirmedAt = new Date('2026-01-01T12:00:00Z');
        const native = await createUser({ email: NATIVE_EMAIL, emailVerifiedAt: confirmedAt });
        const token = await requestToken(native);

        expect(await confirmEmailVerification(token)).toEqual({ userId: native.id, becameNativeAdmin: false });
        expect((await reload(native)).emailVerifiedAt).toEqual(confirmedAt);
        expect(await markEmailVerified(db, native, NOW)).toBe(false);
        expect(await db.$count(adminEvents)).toBe(0);
    });

    it('e-mail comum confirmado não vira admin — por nenhum dos dois caminhos', async () => {
        const viaLink = await createUser();
        const viaReset = await createUser();

        expect(await confirmEmailVerification(await requestToken(viaLink))).toEqual({
            userId: viaLink.id,
            becameNativeAdmin: false,
        });

        await sendPasswordResetLink(viaReset.email, IP);
        await resetPassword({ token: lastResetToken(), email: viaReset.email, password: 'nova-senha-123' });

        for (const user of [await reload(viaLink), await reload(viaReset)]) {
            expect(user.emailVerifiedAt).toEqual(NOW);
            expect(user.isAdmin).toBe(false);
            expect(adminAccess(user)).toBeNull();
        }

        expect(await db.$count(adminEvents)).toBe(0);
    });

    it('pedir o link no próprio e-mail e trocar para o nativo no perfil não ativa nada', async () => {
        const mallory = await createUser({ email: 'mallory@example.com' });
        const token = await requestToken(mallory);

        await updateProfile(mallory, { name: mallory.name, email: NATIVE_EMAIL, title: null, avatar_color: 'violet' });

        expect(adminAccess(await reload(mallory))).toBe('pending');
        await expectHttpError(confirmEmailVerification(token), 404);
        expect(adminAccess(await reload(mallory))).toBe('pending');
        expect(await db.$count(adminEvents)).toBe(0);
    });

    it('não marca um e-mail que a conta já não usa', async () => {
        const user = await createUser({ email: NATIVE_EMAIL });

        // O retrato de quem chama é de antes de uma troca de e-mail no perfil.
        expect(await markEmailVerified(db, { ...user, email: 'antigo@example.com' }, NOW)).toBe(false);
        expect((await reload(user)).emailVerifiedAt).toBeNull();
        expect(await db.$count(adminEvents)).toBe(0);
    });
});

describe('pelas actions', () => {
    it('pedir exige sessão, avisa para onde foi o link e respeita o intervalo', async () => {
        const user = await createUser({ email: 'ana@example.com' });

        expect(await requestEmailVerification()).toMatchObject({ ok: false, status: 401 });

        await signIn(user);

        expect(await requestEmailVerification()).toEqual({
            ok: true,
            data: null,
            toast: { type: 'success', message: 'Enviamos o link de confirmação para ana@example.com.' },
        });
        expect(await requestEmailVerification()).toMatchObject({ ok: false, status: 429, toast: { type: 'error' } });
        expect(sentMail).toHaveLength(1);
    });

    it('o nativo que confirma na própria sessão vai direto para a administração', async () => {
        const native = await createUser({ email: NATIVE_EMAIL });

        await signIn(native);
        await requestEmailVerification();

        expect(await redirectOf(confirmEmail({ token: lastToken() }))).toBe('/admin');
        expect(jar.store.get('taskon_flash')).toContain('Pronto! A administração do Taskon está ativa.');
        expect(adminAccess(await reload(native))).toBe('native');
    });

    it('com sessão, um e-mail comum confirmado vai para o painel', async () => {
        const user = await createUser();

        await signIn(user);
        await requestEmailVerification();

        expect(await redirectOf(confirmEmail({ token: lastToken() }))).toBe('/dashboard');
        expect(jar.store.get('taskon_flash')).toContain('E-mail confirmado.');
    });

    it('o link do nativo aberto na sessão de outra pessoa não leva à administração', async () => {
        const native = await createUser({ email: NATIVE_EMAIL });
        const token = await requestToken(native);

        await signIn(await createUser());

        expect(await redirectOf(confirmEmail({ token }))).toBe('/dashboard');
        expect(adminAccess(await reload(native))).toBe('native');
    });

    it('sem sessão, vai para o login com o aviso na caixa de status', async () => {
        const user = await createUser();
        const token = await requestToken(user);

        expect(await redirectOf(confirmEmail({ token }))).toBe('/login');
        expect(jar.store.get('taskon_status')).toContain('E-mail confirmado. Entre para continuar.');
        expect(jar.store.has('taskon_flash')).toBe(false);
        expect((await reload(user)).emailVerifiedAt).toEqual(NOW);
    });

    it('link que não vale mais vira aviso de erro e a página volta atualizada, sem redirecionar', async () => {
        vi.mocked(refresh).mockClear();

        expect(await confirmEmail({ token: 'x'.repeat(43) })).toEqual({
            ok: false,
            status: 404,
            toast: { type: 'error', message: EMAIL_VERIFICATION_MESSAGES.invalid },
        });
        // A página re-renderizada é a de link indisponível, não o botão que falharia de novo.
        expect(refresh).toHaveBeenCalledTimes(1);

        expect(await confirmEmail({ token: '' })).toMatchObject({ ok: false, status: 422 });
        expect(refresh).toHaveBeenCalledTimes(1);
    });
});

describe('o e-mail', () => {
    it('escapa o que veio de gente', () => {
        const mail = emailVerificationMail({
            name: '<b>Mallory</b>',
            email: '"><img src=x>@evil.test',
            url: 'http://taskon.test/verify-email/abc',
            expiresInMinutes: 90,
        });

        expect(mail.html).not.toContain('<b>Mallory</b>');
        expect(mail.html).toContain('&lt;b&gt;Mallory&lt;/b&gt;');
        expect(mail.html).not.toContain('<img src=x>');
        expect(mail.html).toContain('&quot;&gt;&lt;img src=x&gt;@evil.test');
        expect(mail.html).toContain('90 minutos');
        expect(mail.text).toContain('http://taskon.test/verify-email/abc');
    });
});
