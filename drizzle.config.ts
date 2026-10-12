import { loadEnvConfig } from '@next/env';
import { defineConfig } from 'drizzle-kit';

// O mesmo carregamento de .env do Next (.env.local por cima de .env).
loadEnvConfig(process.cwd());

const url = process.env.DATABASE_URL;

export default defineConfig({
    dialect: 'postgresql',
    schema: './src/server/db/schema.ts',
    out: './drizzle',
    strict: true,
    verbose: true,
    ...(url
        ? { dbCredentials: { url } }
        : { driver: 'pglite', dbCredentials: { url: process.env.PGLITE_DIR || './.data/pglite' } }),
});
