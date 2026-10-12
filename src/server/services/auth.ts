import 'server-only';

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, ne } from 'drizzle-orm';
import { burnPasswordCheck, hashPassword, verifyPassword } from '@/server/auth/password';
import { availableIn, clear, hit, throttle, tooManyAttempts } from '@/server/auth/rate-limit';
import { AVATAR_COLORS, appUrl, config } from '@/server/config';
import { db } from '@/server/db';
import { passwordResetTokens, sessions, users, type UserRow } from '@/server/db/schema';
import { HttpError, invalid } from '@/server/errors';
import { sendMail } from '@/server/mail/mailer';
import { passwordResetMail } from '@/server/mail/password-reset';
import { buildDemoBoard } from '@/server/services/demo-board';

/**
 * Entrar, criar conta e recuperar a senha — o que no Laravel era o
 * `LoginRequest`, o `RegisteredUserController` e o broker de senhas
 * (`Password::sendResetLink` / `Password::reset`).
 *
 * Nada aqui toca em cookie ou cabeçalho: o IP chega por parâmetro e a sessão
 * é aberta pela Server Action (src/server/actions/auth.ts) depois que o
 * serviço aprova. Assim tudo isto roda nos testes, direto no Node.
 */

export const AUTH_MESSAGES = {
    failed: 'Essas credenciais não batem com nossos registros.',
    emailTaken: 'Esse e-mail já está em uso.',
    unknownEmail: 'Não encontramos uma conta com esse e-mail.',
    resetLinkSent: 'Enviamos por e-mail o link para redefinir sua senha.',
    resetThrottled: 'Aguarde um pouco antes de pedir outro link.',
    invalidResetToken: 'Este link de redefinição é inválido ou expirou.',
    mailFailed: 'Não conseguimos enviar o e-mail agora. Tente de novo em instantes.',
} as const;

export function loginThrottledMessage(seconds: number): string {
    return `Muitas tentativas de login. Tente de novo em ${seconds} ${seconds === 1 ? 'segundo' : 'segundos'}.`;
}

/** Tentativas erradas por e-mail+IP antes do bloqueio (a 6ª já é recusada). */
const LOGIN_MAX_ATTEMPTS = 5;

/** O `RateLimiter::hit()` padrão do Laravel: a janela dura um minuto. */
const LOGIN_DECAY_SECONDS = 60;

/** Sem IP conhecido (fora de proxy), todas as requisições dividem o mesmo balde. */
const ipKey = (ip: string | null) => ip ?? 'desconhecido';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * O `throttleKey()` do LoginRequest: e-mail minúsculo + IP. Guardado como
 * hash porque e-mail (até 255 caracteres) + IP não cabe na chave varchar(255)
 * do limitador — e o contador não precisa saber o e-mail de ninguém.
 */
function loginKey(email: string, ip: string | null): string {
    return `login:${sha256(`${email.toLowerCase()}|${ip ?? ''}`)}`;
}

/**
 * A violação de unicidade do Postgres (23505). O Drizzle embrulha o erro do
 * driver (`cause`), então a busca desce pela cadeia.
 */
export function isUniqueViolation(error: unknown): boolean {
    let current: unknown = error;

    for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth++) {
        if ((current as { code?: unknown }).code === '23505') return true;

        current = (current as { cause?: unknown }).cause;
    }

    return false;
}

/**
 * O `unique:users,email` (com `ignore` para o próprio perfil). A checagem
 * antecipada dá a mensagem certa no caso comum; a corrida entre duas
 * requisições ainda é barrada pelo índice único e tratada por quem insere.
 */
export async function ensureEmailAvailable(email: string, exceptUserId?: number): Promise<void> {
    const [taken] = await db
        .select({ id: users.id })
        .from(users)
        .where(exceptUserId === undefined ? eq(users.email, email) : and(eq(users.email, email), ne(users.id, exceptUserId)))
        .limit(1);

    if (taken) invalid('email', AUTH_MESSAGES.emailTaken);
}

async function findUserByEmail(email: string): Promise<UserRow | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

    return user;
}

/* -------------------------------------------------------------------------- */
/* Login                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Confere as credenciais e devolve a pessoa — o `LoginRequest::authenticate()`.
 *
 * Duas travas, como no Laravel:
 *  - por IP, 10 tentativas por minuto, qualquer que seja o e-mail (o
 *    `throttle:10,1` da rota) → 429;
 *  - por e-mail+IP, 5 erros seguidos bloqueiam até a janela fechar → erro no
 *    campo `email`. Acertar a senha zera o contador.
 */
export async function authenticate(credentials: { email: string; password: string }, ip: string | null): Promise<UserRow> {
    await throttle(`login:${ipKey(ip)}`, 10, 1);

    const key = loginKey(credentials.email, ip);

    if (await tooManyAttempts(key, LOGIN_MAX_ATTEMPTS)) {
        invalid('email', loginThrottledMessage(await availableIn(key)));
    }

    const user = await findUserByEmail(credentials.email);

    // E-mail inexistente ainda gasta o tempo de um bcrypt: sem isso, a demora
    // da resposta denunciaria quais contas existem.
    const valid = user
        ? await verifyPassword(credentials.password, user.password)
        : await burnPasswordCheck(credentials.password).then(() => false);

    if (!user || !valid) {
        await hit(key, LOGIN_DECAY_SECONDS);

        invalid('email', AUTH_MESSAGES.failed);
    }

    await clear(key);

    return user;
}

/* -------------------------------------------------------------------------- */
/* Cadastro                                                                    */
/* -------------------------------------------------------------------------- */

function randomAvatarColor(): (typeof AVATAR_COLORS)[number] {
    return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)] ?? 'violet';
}

/**
 * Cria a conta já com o quadro de exemplo — o `RegisteredUserController@store`.
 *
 * Conta e quadro nascem na mesma transação: se o quadro falhar, não sobra uma
 * conta órfã com o e-mail "em uso" e nenhuma sessão aberta.
 *
 * Throttle por IP (10 por minuto): o legado não tinha, mas o app agora está
 * na internet pública, e cada cadastro custa um bcrypt e uma dúzia de
 * inserções.
 */
export async function registerUser(
    input: { name: string; email: string; password: string },
    ip: string | null,
): Promise<UserRow> {
    await throttle(`register:${ipKey(ip)}`, 10, 1);

    await ensureEmailAvailable(input.email);

    const password = await hashPassword(input.password);

    try {
        return await db.transaction(async (tx) => {
            const [user] = await tx
                .insert(users)
                .values({
                    name: input.name,
                    email: input.email,
                    password,
                    avatarColor: randomAvatarColor(),
                    // Opt-out, não opt-in: quem cria a conta já recebe o resumo.
                    dailyDigest: true,
                })
                .returning();

            // Todo mundo entra com um quadro de exemplo pronto — nada de tela vazia.
            await buildDemoBoard(user, undefined, tx);

            return user;
        });
    } catch (error) {
        if (isUniqueViolation(error)) invalid('email', AUTH_MESSAGES.emailTaken);

        throw error;
    }
}

/* -------------------------------------------------------------------------- */
/* Recuperação de senha                                                        */
/* -------------------------------------------------------------------------- */

/** Compara o token do link com o hash guardado sem vazar tempo por byte. */
function tokenMatches(storedHash: string, token: string): boolean {
    const expected = Buffer.from(storedHash, 'hex');
    const given = createHash('sha256').update(token).digest();

    return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * Manda o link de redefinição — o `Password::sendResetLink()`.
 *
 * O token cru só existe no e-mail; o banco guarda o SHA-256 dele (um por
 * e-mail: pedir de novo invalida o link anterior). Um novo pedido para o
 * mesmo e-mail só sai depois de `passwordResetThrottleSeconds`, e o IP tem
 * teto próprio (6 por minuto) para a tela não virar disparador de e-mail.
 */
export async function sendPasswordResetLink(
    email: string,
    ip: string | null,
    now = new Date(),
): Promise<{ status: string }> {
    await throttle(`forgot:${ipKey(ip)}`, 6, 1);

    const user = await findUserByEmail(email);

    if (!user) invalid('email', AUTH_MESSAGES.unknownEmail);

    const [previous] = await db
        .select({ createdAt: passwordResetTokens.createdAt })
        .from(passwordResetTokens)
        .where(eq(passwordResetTokens.email, user.email))
        .limit(1);

    if (previous && now.getTime() - previous.createdAt.getTime() < config.auth.passwordResetThrottleSeconds * 1000) {
        invalid('email', AUTH_MESSAGES.resetThrottled);
    }

    const token = randomBytes(32).toString('base64url');
    const hashed = sha256(token);

    await db
        .insert(passwordResetTokens)
        .values({ email: user.email, token: hashed, createdAt: now })
        .onConflictDoUpdate({ target: passwordResetTokens.email, set: { token: hashed, createdAt: now } });

    const url = appUrl(`/reset-password/${token}?email=${encodeURIComponent(user.email)}`);

    try {
        await sendMail({
            to: user.email,
            ...passwordResetMail({ name: user.name, url, expiresInMinutes: config.auth.passwordResetMinutes }),
        });
    } catch (error) {
        // O link não chegou: sem desfazer o token, a pessoa teria de esperar o
        // intervalo mínimo para pedir de novo um link que nunca recebeu.
        await db.delete(passwordResetTokens).where(eq(passwordResetTokens.email, user.email));

        console.error('[auth] falha ao enviar o link de redefinição de senha', error);

        throw new HttpError(500, AUTH_MESSAGES.mailFailed);
    }

    return { status: AUTH_MESSAGES.resetLinkSent };
}

/**
 * Troca a senha pelo token do e-mail — o `Password::reset()`.
 *
 * O token vale `passwordResetMinutes` e uma vez só. Junto com a senha caem
 * TODAS as sessões abertas da pessoa (o `remember_token` novo do Laravel):
 * quem pede o link pode estar fazendo isso justamente por ter sido invadido.
 */
export async function resetPassword(
    input: { token: string; email: string; password: string },
    now = new Date(),
): Promise<UserRow> {
    const user = await findUserByEmail(input.email);

    if (!user) invalid('email', AUTH_MESSAGES.unknownEmail);

    const [record] = await db
        .select()
        .from(passwordResetTokens)
        .where(eq(passwordResetTokens.email, user.email))
        .limit(1);

    const expired = !record || now.getTime() - record.createdAt.getTime() > config.auth.passwordResetMinutes * 60_000;

    if (!record || expired || !tokenMatches(record.token, input.token)) {
        invalid('email', AUTH_MESSAGES.invalidResetToken);
    }

    const password = await hashPassword(input.password);

    return db.transaction(async (tx) => {
        const [updated] = await tx.update(users).set({ password }).where(eq(users.id, user.id)).returning();

        await tx.delete(passwordResetTokens).where(eq(passwordResetTokens.email, user.email));
        await tx.delete(sessions).where(eq(sessions.userId, user.id));

        return updated;
    });
}
