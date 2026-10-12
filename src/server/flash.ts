import 'server-only';

import { cookies } from 'next/headers';
import { isProduction } from '@/server/config';
import type { Toast } from '@/types';

/**
 * O `Inertia::flash('toast', …)` para actions que TERMINAM EM REDIRECT
 * (criar quadro → página do quadro, excluir card → quadro, login → painel).
 * Como `redirect()` não devolve valor ao cliente, o aviso viaja num cookie de
 * vida curta que o <FlashToaster /> lê, mostra e apaga na tela de destino.
 *
 * Action que fica na mesma tela não precisa disto: devolve o toast no próprio
 * ActionResult.
 */
export const FLASH_COOKIE = 'taskon_flash';

export async function flash(toast: Toast): Promise<void> {
    (await cookies()).set(FLASH_COOKIE, encodeURIComponent(JSON.stringify(toast)), {
        path: '/',
        maxAge: 60,
        sameSite: 'lax',
        secure: isProduction,
        // O navegador precisa ler e apagar — e não carrega nada sensível.
        httpOnly: false,
    });
}
