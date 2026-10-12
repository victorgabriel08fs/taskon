'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { showToast } from '@/lib/actions';
import type { Toast } from '@/types';

/** Mesmo nome de src/server/flash.ts (não dá para importar módulo de servidor aqui). */
const FLASH_COOKIE = 'taskon_flash';

/** Disparado por `runAction` ao fim de toda action — o redirect pode ter deixado um aviso. */
export const FLASH_EVENT = 'taskon:flash';

function takeFlash(): Toast | null {
    const entry = document.cookie.split('; ').find((part) => part.startsWith(`${FLASH_COOKIE}=`));

    if (!entry) return null;

    document.cookie = `${FLASH_COOKIE}=; Max-Age=0; path=/; SameSite=Lax`;

    try {
        const toast = JSON.parse(decodeURIComponent(entry.slice(FLASH_COOKIE.length + 1))) as Toast;

        return toast && typeof toast.message === 'string' ? toast : null;
    } catch {
        return null;
    }
}

/**
 * Mostra o aviso que uma action deixou antes de redirecionar. Confere o
 * cookie a cada troca de rota e a cada fim de action.
 */
export function FlashToaster() {
    const pathname = usePathname();

    useEffect(() => {
        const check = () => showToast(takeFlash() ?? undefined);

        check();
        window.addEventListener(FLASH_EVENT, check);

        return () => window.removeEventListener(FLASH_EVENT, check);
    }, [pathname]);

    return null;
}
