'use server';

import { defineAction } from '@/server/action';
import type { CardContentActions } from '@/server/actions/contract';
import { COLORS } from '@/server/config';
import * as checklistService from '@/server/services/checklists';
import * as commentService from '@/server/services/comments';
import * as labelService from '@/server/services/labels';
import { id, messages, nullableString, oneOf, requiredString, z } from '@/server/validation';

/**
 * O que mora dentro do card: comentários, checklists e etiquetas — os antigos
 * `CommentController`, `ChecklistController` e `LabelController`.
 */

/* -------------------------------------------------------------------------- */
/* Comentários                                                                 */
/* -------------------------------------------------------------------------- */

export const addComment = defineAction(
    z.object({ cardId: id(), body: requiredString(5000) }),
    async ({ cardId, body }, { user }) => {
        await commentService.addComment(user, cardId, { body });

        return null;
    },
) satisfies CardContentActions['addComment'];

/** Só o autor apaga (403 para os outros). */
export const deleteComment = defineAction(
    z.object({ commentId: id() }),
    async ({ commentId }, { user }) => {
        await commentService.deleteComment(user, commentId);

        return null;
    },
) satisfies CardContentActions['deleteComment'];

/* -------------------------------------------------------------------------- */
/* Checklists                                                                  */
/* -------------------------------------------------------------------------- */

export const addChecklist = defineAction(
    z.object({ cardId: id(), title: requiredString(120) }),
    async ({ cardId, title }, { user }) => {
        await checklistService.addChecklist(user, cardId, { title });

        return null;
    },
) satisfies CardContentActions['addChecklist'];

export const deleteChecklist = defineAction(
    z.object({ checklistId: id() }),
    async ({ checklistId }, { user }) => {
        await checklistService.deleteChecklist(user, checklistId);

        return null;
    },
) satisfies CardContentActions['deleteChecklist'];

export const addChecklistItem = defineAction(
    z.object({ checklistId: id(), content: requiredString(500) }),
    async ({ checklistId, content }, { user }) => {
        await checklistService.addChecklistItem(user, checklistId, { content });

        return null;
    },
) satisfies CardContentActions['addChecklistItem'];

export const updateChecklistItem = defineAction(
    z.object({
        itemId: id(),
        content: requiredString(500).optional(),
        is_done: z.boolean({ error: messages.in }).optional(),
    }),
    async ({ itemId, ...input }, { user }) => {
        await checklistService.updateChecklistItem(user, itemId, input);

        return null;
    },
) satisfies CardContentActions['updateChecklistItem'];

export const deleteChecklistItem = defineAction(
    z.object({ itemId: id() }),
    async ({ itemId }, { user }) => {
        await checklistService.deleteChecklistItem(user, itemId);

        return null;
    },
) satisfies CardContentActions['deleteChecklistItem'];

/* -------------------------------------------------------------------------- */
/* Etiquetas (configuração do quadro: owner/admin)                             */
/* -------------------------------------------------------------------------- */

export const createLabel = defineAction(
    z.object({ boardId: id(), name: nullableString(60).optional(), color: oneOf(COLORS) }),
    async ({ boardId, name, color }, { user }) => {
        await labelService.createLabel(user, boardId, { name: name ?? null, color });

        return null;
    },
) satisfies CardContentActions['createLabel'];

export const updateLabel = defineAction(
    z.object({ labelId: id(), name: nullableString(60).optional(), color: oneOf(COLORS).optional() }),
    async ({ labelId, ...input }, { user }) => {
        await labelService.updateLabel(user, labelId, input);

        return null;
    },
) satisfies CardContentActions['updateLabel'];

export const deleteLabel = defineAction(
    z.object({ labelId: id() }),
    async ({ labelId }, { user }) => {
        await labelService.deleteLabel(user, labelId);

        return null;
    },
) satisfies CardContentActions['deleteLabel'];
