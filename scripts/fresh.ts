/**
 * O `php artisan migrate:fresh --seed`: apaga TODAS as tabelas, aplica as
 * migrations do zero e semeia os dados de demonstração.
 *
 *     npm run db:fresh
 *
 * Destrutivo de propósito — por isso recusa rodar com cara de produção
 * (NODE_ENV=production ou VERCEL definido) sem `--force`: além de apagar
 * tudo, as contas semeadas têm senha conhecida.
 *
 * Com o PGlite local, pare o `npm run dev` antes: dois processos abrindo o
 * mesmo diretório do PGlite corrompem o banco.
 */
import './_bootstrap';
import { sql, type SQL } from 'drizzle-orm';
import { SEEDED_ACCOUNTS, SeedError, refuseInProduction, seedDatabase } from './seed';

const migrationsFolder = './drizzle';

interface Executes {
    execute: (query: SQL) => Promise<unknown>;
}

/** `pg` devolve `{ rows }`; o PGlite também — mas o formato varia entre versões. */
function rowsOf<T>(result: unknown): T[] {
    return Array.isArray(result) ? (result as T[]) : ((result as { rows?: T[] }).rows ?? []);
}

/**
 * O `dropAllTables` do Laravel: só as tabelas, sem derrubar o schema
 * `public` (no Supabase ele carrega permissões que o app não recria).
 */
async function dropEverything(db: Executes): Promise<string[]> {
    const tables = rowsOf<{ tablename: string }>(
        await db.execute(sql`select tablename from pg_tables where schemaname = 'public'`),
    ).map((row) => row.tablename);

    if (tables.length > 0) {
        const names = tables.map((name) => `"${name.replace(/"/g, '""')}"`).join(', ');

        await db.execute(sql.raw(`drop table if exists ${names} cascade`));
    }

    // O registro do que já migrou mora no schema "drizzle": sem apagá-lo, o
    // migrate acharia que está tudo aplicado e não recriaria nada.
    await db.execute(sql`drop schema if exists drizzle cascade`);

    return tables;
}

/**
 * Postgres de verdade: DDL pela conexão DIRETA quando existe (como em
 * scripts/migrate.ts) — o pooler em modo transaction serve para o app, não
 * para migrar.
 */
async function resetPostgres(url: string): Promise<string[]> {
    const { Pool } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');

    const pool = new Pool({ connectionString: url, max: 1 });

    try {
        const db = drizzle(pool);
        const dropped = await dropEverything(db);

        await migrate(db, { migrationsFolder });

        return dropped;
    } finally {
        await pool.end();
    }
}

async function resetPglite(): Promise<string[]> {
    const { db } = await import('@/server/db');
    const { migrate } = await import('drizzle-orm/pglite/migrator');

    const dropped = await dropEverything(db);

    await migrate(db as never, { migrationsFolder });

    return dropped;
}

async function main(): Promise<void> {
    refuseInProduction('db:fresh');

    const pooled = process.env.DATABASE_URL;
    const direct = process.env.DATABASE_URL_UNPOOLED || process.env.DIRECT_URL || pooled;

    if (!direct && process.env.VERCEL) {
        throw new SeedError('DATABASE_URL não está configurada — não há banco para recriar.');
    }

    const dropped = direct ? await resetPostgres(direct) : await resetPglite();

    console.info(
        `✓ ${dropped.length} tabela(s) apagada(s) e migrations aplicadas do zero (${direct ? 'Postgres' : 'PGlite local'}).`,
    );

    await seedDatabase();

    console.info('✓ Banco semeado.');
    console.info(SEEDED_ACCOUNTS);
    process.exit(0);
}

main().catch((error: unknown) => {
    console.error('✗ Falha ao recriar o banco:', error instanceof SeedError ? error.message : error);
    process.exit(1);
});
