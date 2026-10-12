'use server';

import { redirect } from 'next/navigation';
import { defineAction, toast } from '@/server/action';
import type { AuthActions } from '@/server/actions/contract';
import { endSession, requestMeta, safeRedirectPath, startSession } from '@/server/auth/session';
import { flash } from '@/server/flash';
import {
    authenticate,
    registerUser,
    resetPassword as resetPasswordWithToken,
    sendPasswordResetLink as sendResetLinkTo,
} from '@/server/services/auth';
import { confirmed, email, messages, newPassword, passwordInput, requiredString, z } from '@/server/validation';

/**
 * Autenticação: login, cadastro, recuperação de senha e logout — o antigo
 * routes/auth.php.
 *
 * As actions de visitante repetem o middleware `guest` do Laravel: quem já
 * tem sessão (outra aba, botão voltar) vai para o painel em vez de logar ou
 * cadastrar por cima.
 */

/** O `confirmed` do Laravel compara com este campo; ele precisa passar pelo schema. */
const passwordConfirmation = z.string().nullable().optional();

/** Entra na conta — o `AuthenticatedSessionController@store`. */
export const login = defineAction(
    z.object({
        email: email(),
        password: passwordInput(),
        remember: z.boolean().default(false),
        next: z.string().nullable().optional(),
    }),
    async (input, ctx) => {
        if (ctx) redirect('/dashboard');

        const { ip } = await requestMeta();
        const user = await authenticate(input, ip);

        // Sessão nova a cada login: o `session()->regenerate()`, contra fixação.
        await startSession(user.id, input.remember);
        await flash(toast('success', `Bem-vindo de volta, ${user.name}!`));

        // O `redirect()->intended()`: volta para onde a pessoa tentou ir.
        redirect(safeRedirectPath(input.next) ?? '/dashboard');
    },
    { auth: 'guest', refresh: false },
) satisfies AuthActions['login'];

/** Cria a conta (com o quadro de exemplo) e já entra — o `RegisteredUserController@store`. */
export const register = defineAction(
    z
        .object({
            name: requiredString(255),
            email: email(),
            password: newPassword(),
            password_confirmation: passwordConfirmation,
        })
        .superRefine(confirmed),
    async (input, ctx) => {
        if (ctx) redirect('/dashboard');

        const { ip } = await requestMeta();
        const user = await registerUser(input, ip);

        await startSession(user.id, false);
        await flash(toast('success', 'Conta criada! Seu primeiro quadro já está lá dentro.'));

        redirect('/dashboard');
    },
    { auth: 'guest', refresh: false },
) satisfies AuthActions['register'];

/**
 * Manda o link de redefinição — o `PasswordResetLinkController@store`. A
 * mensagem volta para a tela, que a mostra no lugar do antigo `status`.
 */
export const sendPasswordResetLink = defineAction(
    z.object({ email: email() }),
    async (input, ctx) => {
        if (ctx) redirect('/dashboard');

        const { ip } = await requestMeta();

        return sendResetLinkTo(input.email, ip);
    },
    { auth: 'guest', refresh: false },
) satisfies AuthActions['sendPasswordResetLink'];

/** Troca a senha pelo token do e-mail e manda para o login — o `NewPasswordController@store`. */
export const resetPassword = defineAction(
    z
        .object({
            token: z.string({ error: messages.required }).min(1, { error: messages.required }),
            email: email(),
            password: newPassword(),
            password_confirmation: passwordConfirmation,
        })
        .superRefine(confirmed),
    async (input, ctx) => {
        if (ctx) redirect('/dashboard');

        await resetPasswordWithToken(input);
        await flash(toast('success', 'Sua senha foi redefinida. Entre com a nova senha.'));

        redirect('/login');
    },
    { auth: 'guest', refresh: false },
) satisfies AuthActions['resetPassword'];

/** Sai da conta — o `AuthenticatedSessionController@destroy`. */
export const logout = defineAction(
    z.void(),
    async () => {
        await endSession();

        redirect('/');
    },
    { auth: 'any', refresh: false },
) satisfies AuthActions['logout'];
