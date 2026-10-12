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
