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

/**
 * O `->with('status', …)` do Laravel: a frase que a tela de destino mostra na
 * caixa verde (não num toast). Hoje só a redefinição de senha → login usa.
 */
export const STATUS_COOKIE = 'taskon_status';

/** Teto do status lido de volta: o cookie é gravável pelo navegador, então o tamanho não é confiável. */
const STATUS_MAX_LENGTH = 200;

/**
 * Os dois avisos vivem um minuto (só precisam sobreviver ao redirect) e não
 * são HttpOnly: o navegador lê o toast e apaga os dois depois de mostrar — e
 * eles não carregam nada sensível.
 */
async function setShortLived(name: string, value: Toast | string): Promise<void> {
    // JSON cru: o Next já aplica encodeURIComponent ao valor do cookie (e o
    // decodifica ao ler), então não há codificação dupla.
    (await cookies()).set(name, JSON.stringify(value), {
        path: '/',
        maxAge: 60,
        sameSite: 'lax',
        secure: isProduction,
        httpOnly: false,
    });
}

export async function flash(toast: Toast): Promise<void> {
    await setShortLived(FLASH_COOKIE, toast);
}

/** Deixa a frase para a próxima tela mostrar na caixa de status. */
export async function flashStatus(message: string): Promise<void> {
    await setShortLived(STATUS_COOKIE, message);
}

/**
 * O status deixado por `flashStatus`, para a página (Server Component)
 * entregar ao formulário. Quem o mostra apaga o cookie no navegador — Server
 * Component não pode mexer em cookie —, por isso ele aparece uma vez só, como
 * o flash da sessão. Conteúdo fora do formato (JSON de uma string curta) é
 * ignorado.
 */
export async function flashedStatus(): Promise<string | null> {
    const raw = (await cookies()).get(STATUS_COOKIE)?.value;

    if (!raw) return null;

    try {
        const status: unknown = JSON.parse(raw);

        return typeof status === 'string' && status.trim() !== '' && status.length <= STATUS_MAX_LENGTH ? status : null;
    } catch {
        return null;
    }
}
