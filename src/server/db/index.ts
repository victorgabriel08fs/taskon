import 'server-only';

import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { attachDatabasePool } from '@vercel/functions';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from 'drizzle-orm/pg-core';
import { Pool } from 'pg';
import * as schema from './schema';

export { schema };

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export type Transaction = PgTransaction<PgQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>;

/** O banco ou uma transação aberta nele — serviços aceitam os dois. */
export type Executor = Database | Transaction;

/**
 * Dois motores, a mesma API do Drizzle:
 *
 *  - `DATABASE_URL` definida → Postgres de verdade via `pg` (Neon, Supabase,
 *    um Postgres local no Docker). É o caminho da Vercel: o pool é anexado ao
 *    ciclo de vida da função para as conexões ociosas fecharem antes de a
 *    instância congelar.
 *  - sem `DATABASE_URL` → PGlite (Postgres compilado para WASM) num diretório
 *    local. Desenvolvimento sem instalar nada, e os testes rodam em memória.
 *
 * Na Vercel a ausência da URL é erro, não fallback: um PGlite dentro da função
 * seria um banco descartável que some a cada deploy, em silêncio.
 */
function createDatabase(): Database {
    const url = process.env.DATABASE_URL;

    if (url) {
        const pool = new Pool({
            connectionString: url,
            max: Number.parseInt(process.env.DATABASE_POOL_MAX ?? '5', 10) || 5,
            idleTimeoutMillis: 5_000,
        });

        if (process.env.VERCEL) attachDatabasePool(pool);

        return drizzleNodePg(pool, { schema }) as unknown as Database;
    }

    if (process.env.VERCEL) {
        throw new Error(
            'DATABASE_URL não está configurada. Conecte um Postgres (Neon ou Supabase) ao projeto na Vercel.',
        );
    }

    // require tardio: o PGlite (~25 MB com o WASM) só é carregado quando é
    // ele o banco. Em produção esta linha nunca roda.
    const require = createRequire(import.meta.url);
    const { PGlite } = require('@electric-sql/pglite') as typeof import('@electric-sql/pglite');
    const { drizzle } = require('drizzle-orm/pglite') as typeof import('drizzle-orm/pglite');

    const dataDir = process.env.PGLITE_DIR || '.data/pglite';

    // O PGlite cria o diretório final, mas não os pais.
    if (!dataDir.includes('://')) mkdirSync(dataDir, { recursive: true });

    const client = new PGlite(dataDir);

    return drizzle(client, { schema }) as unknown as Database;
}

// Em desenvolvimento o Next reavalia módulos a cada edição; sem o cache no
// globalThis cada reload abriria um pool novo (ou um segundo PGlite no mesmo
// diretório, o que corrompe o banco). Nos testes é o contrário: cada arquivo
// ganha o seu banco em memória, isolado dos outros.
const globalForDb = globalThis as unknown as { __taskonDb?: Database };

export const db: Database = process.env.VITEST ? createDatabase() : (globalForDb.__taskonDb ??= createDatabase());
