'use server';

import { redirect } from 'next/navigation';
import { defineAction, ok, toast } from '@/server/action';
import type { InvitationActions } from '@/server/actions/contract';
import { flash } from '@/server/flash';
import * as invitationService from '@/server/services/invitations';
import { id, messages, z } from '@/server/validation';

/**
 * Convites por e-mail para quem ainda não tem conta. Convidar em si é o
 * `addBoardMember` (src/server/actions/boards.ts): conta existente entra na
 * hora, e só quem não tem conta vira convite.
 */

/** Manda o convite de novo — o link anterior para de valer. */
export const resendBoardInvitation = defineAction(
    z.object({ invitationId: id() }),
    async ({ invitationId }, { user }) => {
        const { email } = await invitationService.resendInvitation(user, invitationId);

        return ok(null, toast('success', `Convite reenviado para ${email}.`));
    },
) satisfies InvitationActions['resendBoardInvitation'];

/** Cancela o convite: o link para de valer na hora. */
export const revokeBoardInvitation = defineAction(
    z.object({ invitationId: id() }),
    async ({ invitationId }, { user }) => {
        const { email } = await invitationService.revokeInvitation(user, invitationId);

        return ok(null, toast('success', `Convite de ${email} cancelado.`));
    },
) satisfies InvitationActions['revokeBoardInvitation'];

/**
 * Aceita o convite do link e leva a pessoa para o quadro. Sem sessão, o
 * `runAction` do cliente manda para o login com `?next=` de volta para cá.
 */
export const acceptBoardInvitation = defineAction(
    z.object({ token: z.string({ error: messages.required }).min(1, { error: messages.required }).max(200) }),
    async ({ token }, { user }) => {
        const { boardId, boardTitle, alreadyMember } = await invitationService.acceptInvitation(user, token);

        await flash(
            toast(
                'success',
                alreadyMember ? `Você já participava de "${boardTitle}".` : `Você entrou no quadro "${boardTitle}".`,
            ),
        );

        redirect(`/boards/${boardId}`);
    },
    { refresh: false },
) satisfies InvitationActions['acceptBoardInvitation'];
