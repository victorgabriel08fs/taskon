import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
    // O fuso do app precisa chegar ao navegador: "hoje" e as datas formatadas
    // têm de ser os mesmos no SSR e na hidratação (ver src/lib/timezone.ts).
    env: {
        NEXT_PUBLIC_APP_TIMEZONE: process.env.APP_TIMEZONE || 'America/Sao_Paulo',
    },

    // PGlite (o Postgres local, sem instalar nada) carrega WASM em runtime e
    // só é usado sem DATABASE_URL. Fica fora do bundle e fora da função da
    // Vercel, onde o banco é sempre um Postgres de verdade.
    serverExternalPackages: ['@electric-sql/pglite'],
    outputFileTracingExcludes: {
        '*': ['node_modules/@electric-sql/pglite/**'],
    },

    poweredByHeader: false,
    reactStrictMode: true,
};

export default nextConfig;
