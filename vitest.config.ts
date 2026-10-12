import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
            // Fora do Next, `server-only` lança ao ser importado. Nos testes o
            // código de servidor roda direto no Node, então vira um módulo vazio.
            'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
        },
    },
    test: {
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        setupFiles: ['tests/setup.ts'],
        // Cada arquivo de teste ganha um Postgres em memória (PGlite) só seu.
        env: {
            // Vazia de propósito: com DATABASE_URL exportada no shell ou no CI,
            // os testes rodariam naquele Postgres — e o setup TRUNCA tudo.
            DATABASE_URL: '',
            DATABASE_URL_UNPOOLED: '',
            DIRECT_URL: '',
            PGLITE_DIR: 'memory://',
            APP_TIMEZONE: 'America/Sao_Paulo',
            MAIL_MAILER: 'array',
            APP_URL: 'http://taskon.test',
            TZ: 'UTC',
        },
        testTimeout: 30_000,
        hookTimeout: 60_000,
    },
});
