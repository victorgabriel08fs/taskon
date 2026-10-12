'use server';

import { redirect } from 'next/navigation';
import { defineAction } from '@/server/action';
import type { AuthActions } from '@/server/actions/contract';
import { endSession } from '@/server/auth/session';
import { z } from '@/server/validation';

/**
 * Autenticação: login, cadastro, recuperação de senha e logout — o antigo
 * routes/auth.php.
 */

/** Sai da conta — o `AuthenticatedSessionController@destroy`. */
export const logout = defineAction(
    z.void(),
    async () => {
        await endSession();

        redirect('/');
    },
    { auth: 'any', refresh: false },
) satisfies AuthActions['logout'];
