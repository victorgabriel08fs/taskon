/**
 * Aplica as migrations de ./drizzle no banco configurado — o `php artisan
 * migrate --force`. Idempotente: o Drizzle registra o que já rodou.
 *
 * Na Vercel roda no `vercel-build`, antes do `next build`.
 */
import './_bootstrap';

const migrationsFolder = './drizzle';

async function main() {
    const { db } = await import('@/server/db');

    if (process.env.DATABASE_URL) {
        const { migrate } = await import('drizzle-orm/node-postgres/migrator');

        await migrate(db as never, { migrationsFolder });
    } else {
        const { migrate } = await import('drizzle-orm/pglite/migrator');

        await migrate(db as never, { migrationsFolder });
    }

    console.log(`✓ Migrations aplicadas (${process.env.DATABASE_URL ? 'Postgres' : 'PGlite local'}).`);
    process.exit(0);
}

main().catch((error) => {
    console.error('✗ Falha ao migrar:', error);
    process.exit(1);
});
