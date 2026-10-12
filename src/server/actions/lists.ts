'use server';

import { defineAction } from '@/server/action';
import type { ListActions } from '@/server/actions/contract';
import * as listService from '@/server/services/lists';
import { id, messages, requiredString, z } from '@/server/validation';

/**
 * Listas (colunas) do quadro — as rotas de /lists do antigo routes/web.php.
 * Qualquer membro do quadro pode mexer nelas. Nenhuma tem aviso: a coluna
 * mudando na tela já é a resposta.
 */

const CARD_LIMIT_MESSAGE = 'Use um número inteiro de 1 a 999.';
const INVALID_ID = 'Identificador inválido.';

/**
 * Teto da ordem enviada depois de um arraste — nenhum quadro de verdade chega
 * perto. Sem ele, um pedido forjado com milhares de ids (repetidos, até)
 * custaria ao banco a cada envio.
 */
const MAX_ORDERED_IDS = 1000;

/** Nova coluna no fim do quadro. */
export const createList = defineAction(
    z.object({ boardId: id(), title: requiredString(120) }),
    async ({ boardId, title }, { user }) => {
        await listService.createList(user, boardId, { title });

        return null;
    },
) satisfies ListActions['createList'];

/** Renomear, limitar e marcar como coluna de conclusão. Só os campos enviados mudam. */
export const updateList = defineAction(
    z.object({
        listId: id(),
        title: requiredString(120).optional(),

        // null tira o limite.
        card_limit: z
            .number({ error: CARD_LIMIT_MESSAGE })
            .int({ error: CARD_LIMIT_MESSAGE })
            .min(1, { error: CARD_LIMIT_MESSAGE })
            .max(999, { error: CARD_LIMIT_MESSAGE })
            .nullable()
            .optional(),
        is_done: z.boolean({ error: messages.in }).optional(),
    }),
    async ({ listId, ...changes }, { user }) => {
        await listService.updateList(user, listId, changes);

        return null;
    },
) satisfies ListActions['updateList'];

/** Remove a coluna com os cards dela. */
export const deleteList = defineAction(
    z.object({ listId: id() }),
    async ({ listId }, { user }) => {
        await listService.deleteList(user, listId);

        return null;
    },
) satisfies ListActions['deleteList'];

/** A ordem final inteira das colunas, depois de um arraste. */
export const reorderLists = defineAction(
    z.object({
        boardId: id(),
        ordered_ids: z
            .array(z.number({ error: INVALID_ID }).int({ error: INVALID_ID }), { error: messages.required })
            .min(1, { error: messages.required })
            .max(MAX_ORDERED_IDS, {
                error: `Este quadro tem colunas demais para reordenar (máximo de ${MAX_ORDERED_IDS}).`,
            }),
    }),
    async ({ boardId, ordered_ids }, { user }) => {
        await listService.reorderLists(user, boardId, ordered_ids);

        return null;
    },
) satisfies ListActions['reorderLists'];
