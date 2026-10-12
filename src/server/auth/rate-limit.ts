import 'server-only';

import { eq, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { rateLimits } from '@/server/db/schema';
import { HttpError } from '@/server/errors';

/**
 * O `RateLimiter` do Laravel, com os contadores no banco: em serverless cada
 * requisição pode cair numa instância diferente, então memória local não
 * serve de contador.
 *
 * A janela é fixa (como a do Laravel): o primeiro hit abre `decaySeconds` de
 * janela; ao fim dela o contador recomeça.
 */

/** Registra uma tentativa e devolve quantas já houve na janela atual. */
export async function hit(key: string, decaySeconds: number, now = new Date()): Promise<number> {
    const resetAt = new Date(now.getTime() + decaySeconds * 1000);

    const [row] = await db
        .insert(rateLimits)
        .values({ key, hits: 1, resetAt })
        .onConflictDoUpdate({
            target: rateLimits.key,
            set: {
                hits: sql`case when ${rateLimits.resetAt} <= ${now} then 1 else ${rateLimits.hits} + 1 end`,
                resetAt: sql`case when ${rateLimits.resetAt} <= ${now} then ${resetAt} else ${rateLimits.resetAt} end`,
            },
        })
        .returning({ hits: rateLimits.hits });

    return row?.hits ?? 1;
}

async function current(key: string, now: Date): Promise<{ hits: number; resetAt: Date } | null> {
    const [row] = await db.select().from(rateLimits).where(eq(rateLimits.key, key)).limit(1);

    if (!row || row.resetAt.getTime() <= now.getTime()) return null;

    return { hits: row.hits, resetAt: row.resetAt };
}

export async function tooManyAttempts(key: string, maxAttempts: number, now = new Date()): Promise<boolean> {
    const state = await current(key, now);

    return state !== null && state.hits >= maxAttempts;
}

/** Segundos até a janela fechar (0 se não há bloqueio). */
export async function availableIn(key: string, now = new Date()): Promise<number> {
    const state = await current(key, now);

    return state ? Math.max(1, Math.ceil((state.resetAt.getTime() - now.getTime()) / 1000)) : 0;
}

export async function clear(key: string): Promise<void> {
    await db.delete(rateLimits).where(eq(rateLimits.key, key));
}

/**
 * O middleware `throttle:N,M` do Laravel: N requisições por M minutos. Conta
 * esta tentativa e lança 429 se ela passou do limite.
 */
export async function throttle(key: string, maxAttempts: number, decayMinutes: number): Promise<void> {
    const now = new Date();
    const hits = await hit(`throttle:${key}`, decayMinutes * 60, now);

    if (hits > maxAttempts) {
        const seconds = await availableIn(`throttle:${key}`, now);

        throw new HttpError(429, `Muitas tentativas. Tente de novo em ${seconds} segundo${seconds === 1 ? '' : 's'}.`);
    }
}

/** Faxina oportunista: janelas vencidas não servem para nada. */
export async function pruneRateLimits(now = new Date()): Promise<void> {
    await db.delete(rateLimits).where(sql`${rateLimits.resetAt} <= ${now}`);
}
