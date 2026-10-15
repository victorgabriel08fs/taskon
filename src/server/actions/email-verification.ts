'use server';

import { redirect } from 'next/navigation';
import { defineAction, ok, toast } from '@/server/action';
import type { EmailVerificationActions } from '@/server/actions/contract';
import { flash, flashStatus } from '@/server/flash';
import * as verificationService from '@/server/services/email-verification';
import { messages, z } from '@/server/validation';

/**
 * Confirmação de e-mail: pedir o link (logado) e confirmar por ele (qualquer
 * um que o tenha — o token é a prova da caixa de entrada). A regra mora em
 * src/server/services/email-verification.ts.
 */

/**
 * Manda o link de confirmação para o e-mail da própria conta. Nada na tela
 * depende do envio — o link chega por fora —, então não há o que renderizar
 * de novo.
 */
export const requestEmailVerification = defineAction(
    z.void(),
    async (_input, { user }) => {
        const { email } = await verificationService.sendEmailVerification(user);

        return ok(null, toast('success', `Enviamos o link de confirmação para ${email}.`));
    },
    { refresh: false },
) satisfies EmailVerificationActions['requestEmailVerification'];

/**
 * Confirma pelo token do link. É um POST (o botão da página /verify-email),
 * nunca o GET do próprio link: os scanners dos provedores de e-mail abrem o
 * endereço antes da pessoa e gastariam o token.
 *
 * Não exige sessão — o token já é a prova —, mas o destino depende dela: quem
 * acabou de ativar a administração na própria sessão vai direto para o painel
 * de administração; com sessão, para o painel; sem, para o login.
 *
 * Fica com o `refresh()` padrão de propósito. O sucesso sempre sai pelo
 * redirect, que lança antes dele; o que ele pega é o 404, do link que morreu
 * com a página aberta (venceu, ou foi gasto em outra aba). Aí a página volta
 * como "Link indisponível", com o caminho certo, em vez de continuar
 * oferecendo um botão que falha a cada clique.
 */
export const confirmEmail = defineAction(
    z.object({ token: z.string({ error: messages.required }).min(1, { error: messages.required }).max(200) }),
    async ({ token }, ctx) => {
        const { userId, becameNativeAdmin } = await verificationService.confirmEmailVerification(token);

        if (ctx && becameNativeAdmin && ctx.user.id === userId) {
            await flash(toast('success', 'Pronto! A administração do Taskon está ativa.'));

            redirect('/admin');
        }

        if (ctx) {
            await flash(toast('success', 'E-mail confirmado.'));

            redirect('/dashboard');
        }

        // A caixa de status da tela de login, como na senha redefinida: o
        // aviso fica lá até a pessoa entrar, em vez de sumir num toast.
        await flashStatus('E-mail confirmado. Entre para continuar.');

        redirect('/login');
    },
    { auth: 'any' },
) satisfies EmailVerificationActions['confirmEmail'];
