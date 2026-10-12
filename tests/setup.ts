import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { db } from '@/server/db';
import { sentMail } from '@/server/mail/mailer';

/**
 * O `RefreshDatabase` do Laravel: o banco em memória deste arquivo recebe as
 * migrations uma vez e é zerado antes de cada teste.
 *
 * A trava abaixo é a mesma lição do tests/bootstrap.php do legado (que um dia
 * apagou o banco de desenvolvimento em silêncio): o TRUNCATE só roda se o
 * banco for o PGlite em memória, nunca um Postgres de verdade.
 */
if (process.env.DATABASE_URL || process.env.PGLITE_DIR !== 'memory://') {
    throw new Error('Os testes só rodam no PGlite em memória (DATABASE_URL vazia, PGLITE_DIR=memory://).');
}

beforeAll(async () => {
    await migrate(db as never, { migrationsFolder: './drizzle' });
});

beforeEach(async () => {
    const tables = await db.execute<{ tablename: string }>(
        sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    const rows = (Array.isArray(tables) ? tables : (tables as { rows: { tablename: string }[] }).rows) as {
        tablename: string;
    }[];
    const names = rows.map((row) => `"${row.tablename}"`).join(', ');

    if (names) await db.execute(sql.raw(`truncate table ${names} restart identity cascade`));

    sentMail.length = 0;
});

afterAll(async () => {
    const client = (db as unknown as { $client?: { close?: () => Promise<void> } }).$client;

    await client?.close?.();
});
