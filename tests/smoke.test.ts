import { count } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { users } from '@/server/db/schema';
import { dayKey, parseAppDateTime, startOfAppDay, toAppIso } from '@/lib/timezone';

describe('infraestrutura', () => {
    it('migra e zera o banco em memória', async () => {
        await db.insert(users).values({ name: 'Teste', email: 't@x.test', password: 'x' });
        const [row] = await db.select({ n: count() }).from(users);

        expect(row?.n).toBe(1);
    });

    it('começa cada teste com o banco vazio', async () => {
        const [row] = await db.select({ n: count() }).from(users);

        expect(row?.n).toBe(0);
    });

    it('interpreta datas sem fuso no fuso do app', () => {
        const date = parseAppDateTime('2026-10-12T14:30');

        expect(date?.toISOString()).toBe('2026-10-12T17:30:00.000Z');
        expect(toAppIso(date)).toBe('2026-10-12T14:30:00-03:00');
        expect(dayKey('2026-10-13T02:00:00Z')).toBe('2026-10-12');
        expect(startOfAppDay('2026-10-13T02:00:00Z').toISOString()).toBe('2026-10-12T03:00:00.000Z');
        expect(parseAppDateTime('2026-02-31T10:00')).toBeNull();
    });
});

describe('relógio da aplicação', () => {
    it('congela o tempo também nos timestamps (Carbon::setTestNow)', async () => {
        const { vi } = await import('vitest');
        const { createUser } = await import('./support/factories');

        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));

        try {
            const user = await createUser();

            expect(user.createdAt.toISOString()).toBe('2026-01-15T12:00:00.000Z');
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('horário de verão', () => {
    it('meia-noite que não existiu vira 01:00 do mesmo dia (como o Carbon)', async () => {
        // São Paulo, 4/11/2018: o relógio pulou de 00:00 para 01:00.
        const { fromWallClock: fromWall } = await import('@/lib/timezone');
        const midnight = fromWall(2018, 11, 4);

        expect(midnight.toISOString()).toBe('2018-11-04T03:00:00.000Z');
        expect(dayKey(midnight)).toBe('2018-11-04');
        expect(startOfAppDay('2018-11-04T15:00:00Z').toISOString()).toBe('2018-11-04T03:00:00.000Z');
        expect(fromWall(2026, 10, 12, 14, 30).toISOString()).toBe('2026-10-12T17:30:00.000Z');
    });
});
