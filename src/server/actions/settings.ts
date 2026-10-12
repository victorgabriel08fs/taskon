'use server';

import { redirect } from 'next/navigation';
import { defineAction, ok, toast } from '@/server/action';
import type { SettingsActions } from '@/server/actions/contract';
import { endSession } from '@/server/auth/session';
import { AVATAR_COLORS } from '@/server/config';
import { changePassword, deleteAccount as deleteAccountOf, updateProfile as updateProfileOf } from '@/server/services/profile';
import { confirmed, email, newPassword, nullableString, oneOf, passwordInput, requiredString, z } from '@/server/validation';

/**
 * Configurações da conta: perfil, senha e exclusão — o antigo
 * routes/settings.php. A aparência não passa pelo servidor: fica no
 * navegador (localStorage + cookie), como antes.
 */

/**
 * O `refresh()` padrão importa aqui: o layout raiz é renderizado de novo com
 * o usuário atualizado, e o avatar e o nome do cabeçalho mudam na hora.
 */
export const updateProfile = defineAction(
    z.object({
        name: requiredString(255),
        email: email(),
        title: nullableString(120),
        avatar_color: oneOf(AVATAR_COLORS),
    }),
    async (input, { user }) => {
        await updateProfileOf(user, input);

        return ok(null, toast('success', 'Perfil atualizado.'));
    },
) satisfies SettingsActions['updateProfile'];

export const updatePassword = defineAction(
    z
        .object({
            current_password: passwordInput(),
            password: newPassword(),
            password_confirmation: z.string().nullable().optional(),
        })
        .superRefine(confirmed),
    async (input, { user }) => {
        await changePassword(user, input);

        return ok(null, toast('success', 'Senha alterada com sucesso.'));
    },
    // Nada na tela depende da senha: não há o que renderizar de novo.
    { refresh: false },
) satisfies SettingsActions['updatePassword'];

/** Exclui a conta (confirmada pela senha), encerra a sessão e volta ao início. */
export const deleteAccount = defineAction(
    z.object({ password: passwordInput() }),
    async (input, { user }) => {
        await deleteAccountOf(user, input.password);

        // A linha da sessão já foi junto com a conta (cascata); falta o cookie.
        await endSession();

        redirect('/');
    },
    { refresh: false },
) satisfies SettingsActions['deleteAccount'];
