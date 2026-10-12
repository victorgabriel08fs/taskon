import 'server-only';

import { timingSafeEqual } from 'node:crypto';
import { isProduction } from '@/server/config';

/**
 * O que as rotas de /api/cron têm em comum — o lugar do `routes/console.php`.
 *
 * A Vercel chama cada cron com `Authorization: Bearer $CRON_SECRET`. Sem
 * segredo configurado, as rotas só ficam abertas fora de produção: em
 * produção, uma URL pública que arquiva cards ou dispara e-mail para a base
 * inteira não pode depender de ninguém descobri-la. A comparação é em tempo
 * constante, para o tempo de resposta não ir entregando o segredo.
 */
export function authorizedCron(request: Request): boolean {
    const secret = process.env.CRON_SECRET;

    if (!secret) return !isProduction;

    const given = Buffer.from(request.headers.get('authorization') ?? '');
    const expected = Buffer.from(`Bearer ${secret}`);

    return given.length === expected.length && timingSafeEqual(given, expected);
}

/** "1", "true", "" (só a chave, `?dry-run`) ligam; "0"/"false"/"no" desligam. */
export function queryFlag(value: string | null): boolean {
    return value !== null && !['0', 'false', 'no'].includes(value.toLowerCase());
}
