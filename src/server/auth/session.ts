import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, lte } from 'drizzle-orm';
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
    // Já na forma normalizada: é ela que o login vai receber de volta.
    return safeRedirectPath((await headers()).get('x-taskon-path'));
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

/** Origem fictícia (o TLD .invalid nunca resolve): só serve para o `URL` normalizar o caminho. */
const REDIRECT_BASE = 'http://taskon.invalid';

/** Absoluto no próprio site: "/x" sim; "//x" é outro domínio (URL relativa ao protocolo). */
const isSitePath = (path: string) => path.startsWith('/') && !path.startsWith('//');

/**
 * Caractere de controle (U+0000–U+001F, U+007F) ou barra invertida, em
 * qualquer posição. O navegador APAGA TAB, CR e LF de qualquer ponto da URL
 * ("/\t/evil.com" vira "//evil.com", outro domínio) e trata "\" como "/" em
 * URLs http(s) ("/\evil.com" também é "//evil.com"). Caminho legítimo não tem
 * nenhum dos dois — eles chegam codificados (%09, %5C), e esses passam.
 */
function hasControlOrBackslash(path: string): boolean {
    for (let index = 0; index < path.length; index++) {
        const code = path.charCodeAt(index);

        if (code <= 0x1f || code === 0x7f || code === 0x5c) return true;
    }

    return false;
}

/**
 * Aceita só caminhos internos ("/boards/1?x=1#y") e devolve a forma
 * NORMALIZADA — senão o `?next=` vira redirecionamento aberto.
 *
 * Checar prefixo não basta: o navegador limpa e resolve a URL antes de
 * segui-la. Por isso, além de recusar controle e "\", o caminho passa pelo
 * mesmo algoritmo do navegador (o `URL` do WHATWG) e a decisão vale para o
 * resultado — que é o que sai daqui. A segunda checagem pega o que só vira
 * outro domínio depois de normalizado: "/.//evil.com" e "/a/..//evil.com"
 * resolvem para "//evil.com".
 */
export function safeRedirectPath(path: string | null | undefined): string | null {
    if (!path || hasControlOrBackslash(path) || !isSitePath(path)) return null;

    // Caminho que começa com "/" sobre uma base http não tem como falhar no
    // parser; a origem é conferida mesmo assim, como última trava.
    const url = new URL(path, REDIRECT_BASE);

    if (url.origin !== REDIRECT_BASE) return null;

    const normalized = url.pathname + url.search + url.hash;

    return isSitePath(normalized) ? normalized : null;
}

/** Faxina oportunista das sessões vencidas (chamada pelos crons). */
export async function pruneExpiredSessions(now = new Date()): Promise<void> {
    await db.delete(sessions).where(lte(sessions.expiresAt, now));
}
