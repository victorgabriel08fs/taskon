import { count, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { verifyPassword } from '@/server/auth/password';
import { AVATAR_COLORS } from '@/server/config';
import { db } from '@/server/db';
import { activities, boardUser, boards, cards, passwordResetTokens, sessions, users } from '@/server/db/schema';
import { sentMail } from '@/server/mail/mailer';
import {
    AUTH_MESSAGES,
    authenticate,
    isUniqueViolation,
    registerUser,
    resetPassword,
    sendPasswordResetLink,
} from '@/server/services/auth';
import { expectHttpError } from './support/assertions';
import { createUser } from './support/factories';

/**
 * O porte de tests/Feature/Auth/* no nível de serviço: a sessão (cookie) é
 * coisa da Server Action; aqui fica a regra — credenciais, limites, cadastro
 * e o ciclo do link de redefinição.
 */

const IP = '203.0.113.7';

async function sessionsOf(userId: number): Promise<number> {
    const [row] = await db.select({ n: count() }).from(sessions).where(eq(sessions.userId, userId));

    return row?.n ?? 0;
}

async function openSession(userId: number, id: string): Promise<void> {
    await db.insert(sessions).values({ id, userId, expiresAt: new Date(Date.now() + 3_600_000) });
}

/** O token cru só existe no e-mail — como no teste de verdade, ele sai de lá. */
function tokenFromMail(): string {
    const text = sentMail.at(-1)?.text ?? '';
    const match = /\/reset-password\/([A-Za-z0-9_-]+)\?email=/.exec(text);

    expect(match, 'o e-mail deveria trazer o link de redefinição').not.toBeNull();

    return match![1]!;
}

describe('cadastro', () => {
    it('cria a conta com o quadro de exemplo', async () => {
        const user = await registerUser(
            { name: 'Victor', email: 'victor@example.com', password: 'senha-super-secreta' },
            IP,
        );

        expect(user).toMatchObject({ name: 'Victor', email: 'victor@example.com', dailyDigest: true, title: null });
        expect(AVATAR_COLORS).toContain(user.avatarColor);
        expect(user.password).not.toBe('senha-super-secreta');
        expect(await verifyPassword('senha-super-secreta', user.password)).toBe(true);

        const memberships = await db.select().from(boardUser).where(eq(boardUser.userId, user.id));

        expect(memberships, 'A conta nova deve nascer com um quadro de exemplo.').toHaveLength(1);
        expect(memberships[0]?.role).toBe('owner');

        const [board] = await db.select().from(boards).where(eq(boards.id, memberships[0]!.boardId));
        const [cardTotal] = await db.select({ n: count() }).from(cards).where(eq(cards.boardId, board!.id));

        expect(board?.title).toBe('Meu primeiro quadro');
        expect(cardTotal?.n).toBeGreaterThan(0);

        const [created] = await db.select().from(activities).where(eq(activities.boardId, board!.id));

        expect(created).toMatchObject({ type: 'board.created', userId: user.id });
    });

    it('recusa e-mail que já tem conta', async () => {
        await createUser({ email: 'ocupado@example.com' });

        const error = await expectHttpError(
            registerUser({ name: 'Outro', email: 'ocupado@example.com', password: 'senha-super-secreta' }, IP),
            422,
            'email',
        );

        expect(error.errors?.email).toBe(AUTH_MESSAGES.emailTaken);

        const [total] = await db.select({ n: count() }).from(users);

        expect(total?.n).toBe(1);
    });

    it('reconhece a violação de unicidade que o banco devolve numa corrida', async () => {
        await createUser({ email: 'corrida@example.com' });

        let caught: unknown;

        try {
            await db.insert(users).values({ name: 'Duplicada', email: 'corrida@example.com', password: 'x' });
        } catch (error) {
            caught = error;
        }

        expect(caught).toBeDefined();
        expect(isUniqueViolation(caught)).toBe(true);
        expect(isUniqueViolation(new Error('qualquer outra falha'))).toBe(false);
    });

    it('limita o cadastro a 10 por minuto por IP', async () => {
        for (let attempt = 1; attempt <= 10; attempt++) {
            await registerUser({ name: `Pessoa ${attempt}`, email: `p${attempt}@example.com`, password: 'senha-secreta' }, IP);
        }

        await expectHttpError(
            registerUser({ name: 'Uma a mais', email: 'p11@example.com', password: 'senha-secreta' }, IP),
            429,
        );
    });
});

describe('login', () => {
    it('autentica com a senha certa', async () => {
        const user = await createUser();

        const authenticated = await authenticate({ email: user.email, password: 'password' }, IP);

        expect(authenticated.id).toBe(user.id);
    });

    it('recusa a senha errada com erro no e-mail', async () => {
        const user = await createUser();

        const error = await expectHttpError(authenticate({ email: user.email, password: 'senha-errada' }, IP), 422, 'email');

        expect(error.errors?.email).toBe(AUTH_MESSAGES.failed);
    });

    it('recusa e-mail sem conta com a mesma mensagem', async () => {
        const error = await expectHttpError(
            authenticate({ email: 'ninguem@example.com', password: 'password' }, IP),
            422,
            'email',
        );

        expect(error.errors?.email).toBe(AUTH_MESSAGES.failed);
    });

    it('bloqueia na 6ª tentativa — mesmo com a senha certa — só para aquele e-mail e IP', async () => {
        const user = await createUser();

        for (let attempt = 1; attempt <= 5; attempt++) {
            const error = await expectHttpError(authenticate({ email: user.email, password: 'errada' }, IP), 422, 'email');

            expect(error.errors?.email).toBe(AUTH_MESSAGES.failed);
        }

        const blocked = await expectHttpError(authenticate({ email: user.email, password: 'password' }, IP), 422, 'email');

        expect(blocked.errors?.email).toMatch(/^Muitas tentativas de login\. Tente de novo em \d+ segundos?\.$/);

        // Outro IP não herda o bloqueio.
        await expect(authenticate({ email: user.email, password: 'password' }, '198.51.100.1')).resolves.toMatchObject({
            id: user.id,
        });
    });

    it('acertar a senha zera o contador de erros', async () => {
        const user = await createUser();

        for (let attempt = 1; attempt <= 4; attempt++) {
            await expectHttpError(authenticate({ email: user.email, password: 'errada' }, IP), 422, 'email');
        }

        await authenticate({ email: user.email, password: 'password' }, IP);

        // Mais 4 erros não bloqueiam: a conta recomeçou do zero.
        for (let attempt = 1; attempt <= 4; attempt++) {
            const error = await expectHttpError(authenticate({ email: user.email, password: 'errada' }, IP), 422, 'email');

            expect(error.errors?.email).toBe(AUTH_MESSAGES.failed);
        }
    });

    it('limita o IP a 10 tentativas por minuto, qualquer que seja o e-mail', async () => {
        for (let attempt = 1; attempt <= 10; attempt++) {
            await expectHttpError(authenticate({ email: `x${attempt}@example.com`, password: 'errada' }, IP), 422, 'email');
        }

        await expectHttpError(authenticate({ email: 'x11@example.com', password: 'errada' }, IP), 429);
    });
});

describe('recuperação de senha', () => {
    it('recusa e-mail sem conta', async () => {
        const error = await expectHttpError(sendPasswordResetLink('ninguem@example.com', IP), 422, 'email');

        expect(error.errors?.email).toBe(AUTH_MESSAGES.unknownEmail);
        expect(sentMail).toHaveLength(0);
    });

    it('manda o link e guarda só o hash do token', async () => {
        const user = await createUser({ name: 'Ana Souza', email: 'ana@example.com' });

        const result = await sendPasswordResetLink(user.email, IP);

        expect(result).toEqual({ status: AUTH_MESSAGES.resetLinkSent });
        expect(sentMail).toHaveLength(1);

        const mail = sentMail[0]!;

        expect(mail.to).toBe('ana@example.com');
        expect(mail.subject).toContain('senha');
        expect(mail.html).toContain('Olá, Ana.');
        expect(mail.text).toContain('http://taskon.test/reset-password/');
        expect(mail.text).toContain('?email=ana%40example.com');

        const token = tokenFromMail();
        const [stored] = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.email, user.email));

        expect(stored?.token).toMatch(/^[0-9a-f]{64}$/);
        expect(stored?.token).not.toBe(token);
    });

    it('não manda outro link antes do intervalo mínimo', async () => {
        const user = await createUser();
        const now = new Date();

        await sendPasswordResetLink(user.email, IP, now);

        const error = await expectHttpError(
            sendPasswordResetLink(user.email, IP, new Date(now.getTime() + 30_000)),
            422,
            'email',
        );

        expect(error.errors?.email).toBe(AUTH_MESSAGES.resetThrottled);

        await sendPasswordResetLink(user.email, IP, new Date(now.getTime() + 61_000));

        expect(sentMail).toHaveLength(2);
    });

    it('troca a senha com o token válido, apaga o token e derruba todas as sessões', async () => {
        const user = await createUser();

        await openSession(user.id, 'a'.repeat(64));
        await openSession(user.id, 'b'.repeat(64));
        await sendPasswordResetLink(user.email, IP);

        const updated = await resetPassword({ token: tokenFromMail(), email: user.email, password: 'nova-senha-123' });

        expect(updated.id).toBe(user.id);
        expect(await verifyPassword('nova-senha-123', updated.password)).toBe(true);
        expect(await verifyPassword('password', updated.password)).toBe(false);
        expect(await sessionsOf(user.id)).toBe(0);
        expect(await db.select().from(passwordResetTokens)).toHaveLength(0);

        // O link vale uma vez só.
        await expectHttpError(
            resetPassword({ token: tokenFromMail(), email: user.email, password: 'outra-senha-123' }),
            422,
            'email',
        );
    });

    it('recusa o token expirado', async () => {
        const user = await createUser();
        const requestedAt = new Date();

        await sendPasswordResetLink(user.email, IP, requestedAt);

        const error = await expectHttpError(
            resetPassword(
                { token: tokenFromMail(), email: user.email, password: 'nova-senha-123' },
                new Date(requestedAt.getTime() + 61 * 60_000),
            ),
            422,
            'email',
        );

        expect(error.errors?.email).toBe(AUTH_MESSAGES.invalidResetToken);

        const [fresh] = await db.select().from(users).where(eq(users.id, user.id));

        expect(await verifyPassword('password', fresh!.password)).toBe(true);
    });

    it('aceita o token até o fim da validade', async () => {
        const user = await createUser();
        const requestedAt = new Date();

        await sendPasswordResetLink(user.email, IP, requestedAt);

        await resetPassword(
            { token: tokenFromMail(), email: user.email, password: 'nova-senha-123' },
            new Date(requestedAt.getTime() + 59 * 60_000),
        );
    });

    it('recusa o token errado e o token de outra pessoa', async () => {
        const ana = await createUser({ email: 'ana@example.com' });
        const bia = await createUser({ email: 'bia@example.com' });

        await sendPasswordResetLink(ana.email, IP);
        const anaToken = tokenFromMail();

        await sendPasswordResetLink(bia.email, IP);

        const wrong = await expectHttpError(
            resetPassword({ token: 'token-inventado', email: ana.email, password: 'nova-senha-123' }),
            422,
            'email',
        );

        expect(wrong.errors?.email).toBe(AUTH_MESSAGES.invalidResetToken);

        await expectHttpError(
            resetPassword({ token: anaToken, email: bia.email, password: 'nova-senha-123' }),
            422,
            'email',
        );
    });

    it('um pedido novo invalida o link anterior', async () => {
        const user = await createUser();
        const now = new Date();

        await sendPasswordResetLink(user.email, IP, now);
        const first = tokenFromMail();

        await sendPasswordResetLink(user.email, IP, new Date(now.getTime() + 61_000));
        const second = tokenFromMail();

        expect(second).not.toBe(first);

        await expectHttpError(
            resetPassword({ token: first, email: user.email, password: 'nova-senha-123' }, new Date(now.getTime() + 62_000)),
            422,
            'email',
        );

        await resetPassword({ token: second, email: user.email, password: 'nova-senha-123' }, new Date(now.getTime() + 62_000));
    });

    it('se o e-mail não sai, desfaz o token para a pessoa poder pedir de novo na hora', async () => {
        const user = await createUser();
        const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});

        // Resend sem chave: o mailer lança antes de qualquer chamada de rede.
        vi.stubEnv('MAIL_MAILER', 'resend');
        vi.stubEnv('RESEND_API_KEY', '');

        try {
            const error = await expectHttpError(sendPasswordResetLink(user.email, IP), 500);

            expect(error.message).toBe(AUTH_MESSAGES.mailFailed);
            expect(await db.select().from(passwordResetTokens)).toHaveLength(0);
        } finally {
            vi.unstubAllEnvs();
            quiet.mockRestore();
        }

        await expect(sendPasswordResetLink(user.email, IP)).resolves.toEqual({ status: AUTH_MESSAGES.resetLinkSent });
        expect(sentMail).toHaveLength(1);
    });

    it('limita os pedidos de link a 6 por minuto por IP', async () => {
        for (let attempt = 1; attempt <= 6; attempt++) {
            await expectHttpError(sendPasswordResetLink(`n${attempt}@example.com`, IP), 422, 'email');
        }

        await expectHttpError(sendPasswordResetLink('n7@example.com', IP), 429);
    });
});
