import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, lte, ne } from 'drizzle-orm';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { config, isProduction } from '@/server/config';
import { db } from '@/server/db';
import { sessions, users, type SessionRow, type UserRow } from '@/server/db/schema';

/**
 * Sessão por cookie HttpOnly, como a do Laravel — sem JWT, sem token no
 * localStorage. O cookie carrega um token aleatório; o banco guarda só o
 * SHA-256 dele.
 *
 *  - sem "lembrar de mim": cookie de sessão do navegador + expiração por
 *    inatividade no servidor (SESSION_LIFETIME minutos, deslizante);
 *  - com "lembrar de mim": cookie persistente de 400 dias.
 */
export const SESSION_COOKIE = 'taskon_session';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

const lifetimeMs = () => config.auth.sessionLifetimeMinutes * 60_000;
const rememberMs = () => config.auth.rememberDays * 86_400_000;

/** Só regrava a expiração deslizante quando passou mais que isto desde a última. */
const TOUCH_EVERY_MS = 60_000;

export async function requestMeta(): Promise<{ ip: string | null; userAgent: string | null }> {
    const list = await headers();
    const forwarded = list.get('x-forwarded-for')?.split(',')[0]?.trim();

    return {
        ip: (forwarded || list.get('x-real-ip') || null)?.slice(0, 45) ?? null,
        userAgent: list.get('user-agent'),
    };
}

/**
 * Abre uma sessão nova para o usuário. Descarta a anterior deste navegador —
 * o `session()->regenerate()` do Laravel, que impede fixação de sessão.
 *
 * Só pode ser chamada de Server Action ou Route Handler (mexe em cookie).
 */
export async function startSession(userId: number, remember: boolean): Promise<void> {
    const jar = await cookies();
    const previous = jar.get(SESSION_COOKIE)?.value;

    if (previous) await db.delete(sessions).where(eq(sessions.id, hashToken(previous)));

    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (remember ? rememberMs() : lifetimeMs()));
    const meta = await requestMeta();

    await db.insert(sessions).values({
        id: hashToken(token),
        userId,
        remember,
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
        lastActivityAt: now,
        expiresAt,
    });

    jar.set(SESSION_COOKIE, token, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax',
        path: '/',
        ...(remember ? { expires: expiresAt } : {}),
    });
}

/** Encerra a sessão deste navegador (logout). */
export async function endSession(): Promise<void> {
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE)?.value;

    if (token) await db.delete(sessions).where(eq(sessions.id, hashToken(token)));

    jar.delete(SESSION_COOKIE);
}

/** Derruba todas as sessões do usuário — menos, opcionalmente, a atual. */
export async function endOtherSessions(userId: number, keepCurrent: boolean): Promise<void> {
    const current = keepCurrent ? await currentSession() : null;

    await db
        .delete(sessions)
        .where(current ? and(eq(sessions.userId, userId), ne(sessions.id, current.session.id)) : eq(sessions.userId, userId));
}

/**
 * A sessão e o usuário desta requisição, ou null. Memoizado por requisição
 * (`cache` do React): layout, página e componentes podem chamar à vontade.
 */
export const currentSession = cache(async (): Promise<{ session: SessionRow; user: UserRow } | null> => {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;

    if (!token) return null;

    const id = hashToken(token);
    const now = new Date();

    const [row] = await db
        .select({ session: sessions, user: users })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(and(eq(sessions.id, id), gt(sessions.expiresAt, now)))
        .limit(1);

    if (!row) return null;

    if (now.getTime() - row.session.lastActivityAt.getTime() > TOUCH_EVERY_MS) {
        const expiresAt = new Date(now.getTime() + (row.session.remember ? rememberMs() : lifetimeMs()));

        await db.update(sessions).set({ lastActivityAt: now, expiresAt }).where(eq(sessions.id, id));
    }

    return row;
});

export async function currentUser(): Promise<UserRow | null> {
    return (await currentSession())?.user ?? null;
}

/** Caminho que o proxy anota na requisição — vira o `?next=` do login. */
async function requestedPath(): Promise<string | null> {
    const path = (await headers()).get('x-taskon-path');

    return path && safeRedirectPath(path) ? path : null;
}

/**
 * Páginas autenticadas: devolve o usuário ou manda para o login, guardando o
 * destino (o `redirect()->intended()` do Laravel).
 */
export async function requireUser(): Promise<UserRow> {
    const user = await currentUser();

    if (!user) {
        const next = await requestedPath();

        redirect(next ? `/login?next=${encodeURIComponent(next)}` : '/login');
    }

    return user;
}

/** Páginas de visitante (login, cadastro…): quem já entrou vai para o painel. */
export async function redirectIfAuthenticated(): Promise<void> {
    if (await currentUser()) redirect('/dashboard');
}

/**
 * Aceita só caminhos internos ("/boards/1"). Bloqueia "//evil.com",
 * "/\evil.com" e URLs absolutas — senão o `?next=` vira redirecionamento aberto.
 */
export function safeRedirectPath(path: string | null | undefined): string | null {
    if (!path || !path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return null;

    return path;
}

/** Faxina oportunista das sessões vencidas (chamada pelos crons). */
export async function pruneExpiredSessions(now = new Date()): Promise<void> {
    await db.delete(sessions).where(lte(sessions.expiresAt, now));
}
