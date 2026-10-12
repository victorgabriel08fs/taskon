/**
 * Aplica as migrations de ./drizzle no banco configurado — o `php artisan
 * migrate --force`. Idempotente: o Drizzle registra o que já rodou.
 *
 * Na Vercel roda no `vercel-build`, antes do `next build`.
 *
 * DDL vai pela conexão DIRETA quando existe: a integração do Neon injeta
 * `DATABASE_URL_UNPOOLED`, e no Supabase convém apontar `DIRECT_URL` para a
 * porta 5432 (o pooler em modo transaction da 6543 serve para o app, não para
 * migrar). Sem nenhuma das duas, usa a `DATABASE_URL` mesmo.
 */
import './_bootstrap';

const migrationsFolder = './drizzle';

async function migratePostgres(url: string) {
    const { Pool } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');

    const pool = new Pool({ connectionString: url, max: 1 });

    try {
        await migrate(drizzle(pool), { migrationsFolder });
    } finally {
        await pool.end();
    }
}

async function migratePglite() {
    const { db } = await import('@/server/db');
    const { migrate } = await import('drizzle-orm/pglite/migrator');

    await migrate(db as never, { migrationsFolder });
}

async function main() {
    const pooled = process.env.DATABASE_URL;
    const direct = process.env.DATABASE_URL_UNPOOLED || process.env.DIRECT_URL || pooled;

    if (direct) {
        await migratePostgres(direct);
    } else {
        if (process.env.VERCEL) {
            throw new Error('DATABASE_URL não está configurada no projeto da Vercel — nada para migrar.');
        }

        await migratePglite();
    }

    console.log(`✓ Migrations aplicadas (${direct ? 'Postgres' : 'PGlite local'}).`);
    process.exit(0);
}

main().catch((error) => {
    console.error('✗ Falha ao migrar:', error);
    process.exit(1);
});
