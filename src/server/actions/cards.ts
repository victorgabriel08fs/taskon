'use server';

import { redirect } from 'next/navigation';
import { defineAction, toast } from '@/server/action';
import type { CardActions } from '@/server/actions/contract';
import { COLORS } from '@/server/config';
import { flash } from '@/server/flash';
import * as cardService from '@/server/services/cards';
import { id, messages, nullableDateTime, nullableString, requiredString, z } from '@/server/validation';

/**
 * Cards — o antigo `CardController` (menos arquivar/restaurar, que moram em
 * archive.ts). As regras estão em src/server/services/cards.ts; aqui só a
 * validação e o aviso.
 */

/**
 * Cor de capa ou null. "" também desliga a capa, como o
 * ConvertEmptyStringsToNull do Laravel fazia antes do `nullable`.
 */
const nullableColor = z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.enum(COLORS, { error: messages.in }).nullable(),
);

/** Entra no fim da lista; quem cria já vira responsável. */
export const createCard = defineAction(
    z.object({ listId: id(), title: requiredString(500) }),
    async ({ listId, title }, { user }) => cardService.createCard(user, listId, { title }),
) satisfies CardActions['createCard'];

/** Só os campos enviados mudam. `due_at` no formato do datetime-local (fuso do app) ou null. */
export const updateCard = defineAction(
    z.object({
        cardId: id(),
        title: requiredString(500).optional(),
        description: nullableString(20000).optional(),
        cover_color: nullableColor.optional(),
        due_at: nullableDateTime().optional(),
        is_completed: z.boolean({ error: messages.in }).optional(),
    }),
    async ({ cardId, ...input }, { user }) => {
        await cardService.updateCard(user, cardId, input);

        return null;
    },
) satisfies CardActions['updateCard'];

export const deleteCard = defineAction(
    z.object({ cardId: id() }),
    async ({ cardId }, { user }) => {
        const card = await cardService.deleteCard(user, cardId);

        await flash(toast('success', `"${card.title}" foi excluído.`));

        // Redirect explícito, não "voltar": a URL anterior pode ser a do
        // próprio card (/boards/1/cards/42), que agora daria 404.
        redirect(`/boards/${card.boardId}`);
    },
) satisfies CardActions['deleteCard'];

/** O cliente manda a ordem final inteira da lista de destino. */
export const moveCard = defineAction(
    z.object({
        cardId: id(),
        board_list_id: id(),
        ordered_ids: z
            .array(z.number({ error: 'Use só números inteiros.' }).int({ error: 'Use só números inteiros.' }), {
                error: messages.required,
            })
            .min(1, { error: messages.required }),
    }),
    async ({ cardId, ...input }, { user }) => {
        await cardService.moveCard(user, cardId, input);

        return null;
    },
) satisfies CardActions['moveCard'];

export const toggleCardLabel = defineAction(
    z.object({ cardId: id(), labelId: id() }),
    async ({ cardId, labelId }, { user }) => {
        await cardService.toggleCardLabel(user, cardId, labelId);

        return null;
    },
) satisfies CardActions['toggleCardLabel'];

export const toggleCardMember = defineAction(
    z.object({ cardId: id(), userId: id() }),
    async ({ cardId, userId }, { user }) => {
        await cardService.toggleCardMember(user, cardId, userId);

        return null;
    },
) satisfies CardActions['toggleCardMember'];
