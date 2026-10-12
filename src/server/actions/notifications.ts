'use server';

import { defineAction, ok, toast } from '@/server/action';
import type { NotificationActions } from '@/server/actions/contract';
import { throttle } from '@/server/auth/rate-limit';
import { HttpError } from '@/server/errors';
import { sendDigestNow, setDailyDigest } from '@/server/services/daily-digest';
import { z } from '@/server/validation';

/**
 * Configurações › Notificações — o antigo `Settings\NotificationController`
 * (update e test).
 */

/** Liga ou desliga o resumo diário. */
export const updateDigestPreference = defineAction(
    z.object({
        daily_digest: z.boolean({ error: 'Escolha entre ligado e desligado.' }),
    }),
    async (input, { user }) => {
        await setDailyDigest(user, input.daily_digest);

        return ok(
            null,
            toast('success', input.daily_digest ? 'Resumo diário ativado.' : 'Resumo diário desativado.'),
        );
    },
) satisfies NotificationActions['updateDigestPreference'];

/**
 * Manda o resumo de agora para a própria pessoa, sem carimbar o envio do dia.
 *
 * O envio de teste bate no Resend de verdade — throttle (3 por minuto) para o
 * botão não virar um gerador de e-mail (e de custo).
 */
export const sendTestDigest = defineAction(
    z.void(),
    async (_input, { user }) => {
        await throttle(`digest-test:${user.id}`, 3, 1);

        try {
            await sendDigestNow(user);
        } catch (error) {
            console.error('[digest] falha no envio de teste', { user_id: user.id, error });

            throw new HttpError(500, `Não consegui enviar: ${error instanceof Error ? error.message : String(error)}`);
        }

        return ok(null, toast('success', `Resumo enviado para ${user.email}.`));
    },
) satisfies NotificationActions['sendTestDigest'];
