/**
 * Preparo comum dos scripts de linha de comando (o lugar do `php artisan`):
 * carrega o .env do mesmo jeito que o Next (.env.local por cima de .env).
 *
 * Os scripts rodam com `--conditions=react-server` (ver package.json) para que
 * os módulos marcados com `import 'server-only'` possam ser importados fora do
 * Next.
 */
import nextEnv from '@next/env';

// Default import: o pacote é CommonJS empacotado, sem exports nomeados detectáveis em ESM.
nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');
