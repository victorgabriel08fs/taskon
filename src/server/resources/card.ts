import 'server-only';

import type { ArchivedCard, CardDetail, CardExportDetail, Checklist, ColorKey, Comment } from '@/types';
import { toAppIso } from '@/lib/timezone';
import type { ActivityRow, CardRow, ChecklistItemRow, ChecklistRow, CommentRow, UserRow } from '@/server/db/schema';
import { activityResource, userResource } from '@/server/resources/common';

/**
 * Os resources do card — o contrato de saída do modal, da gaveta de
 * arquivados e da exportação. Cada função devolve EXATAMENTE o formato do
 * antigo `JsonResource` (CardDetailResource, CommentResource,
 * ChecklistResource, ArchivedCardResource, CardExportResource).
 *
 * As consultas que alimentam estas funções moram em src/server/queries/card.ts.
 */

type UserLike = Pick<UserRow, 'id' | 'name' | 'email' | 'avatarColor' | 'title'>;

export type CommentSource = Pick<CommentRow, 'id' | 'body' | 'createdAt' | 'userId'> & { author: UserLike };

export type ChecklistSource = Pick<ChecklistRow, 'id' | 'title' | 'position'> & {
    items: Pick<ChecklistItemRow, 'id' | 'content' | 'isDone' | 'position'>[];
};

export type CardActivitySource = Pick<ActivityRow, 'id' | 'type' | 'description' | 'properties' | 'createdAt'> & {
    user: UserLike | null;
};

export type CardDetailSource = Pick<
    CardRow,
    | 'id'
    | 'boardId'
    | 'boardListId'
    | 'title'
    | 'description'
    | 'coverColor'
    | 'dueAt'
    | 'completedAt'
    | 'archivedAt'
    | 'createdAt'
> & {
    list: { title: string };
    labels: { labelId: number }[];
    members: { userId: number }[];
    comments: CommentSource[];
    checklists: ChecklistSource[];
    activities: CardActivitySource[];
};

export type ArchivedCardSource = Pick<CardRow, 'id' | 'title' | 'dueAt' | 'completedAt' | 'archivedAt'> & {
    listTitle: string | null;
};

export interface CardExportSource {
    id: number;
    description: string | null;
    checklists: { title: string; items: { content: string; isDone: boolean }[] }[];
    comments: { body: string; createdAt: Date; author: { name: string } | null }[];
}

/** CommentResource. `can_delete` diz se QUEM ESTÁ VENDO é o autor. */
export function commentResource(comment: CommentSource, viewerId: number): Comment {
    return {
        id: comment.id,
        body: comment.body,
        created_at: toAppIso(comment.createdAt) ?? '',
        author: userResource(comment.author),
        can_delete: viewerId === comment.userId,
    };
}

/** ChecklistResource — os itens já vêm na ordem de `position`. */
export function checklistResource(checklist: ChecklistSource): Checklist {
    return {
        id: checklist.id,
        title: checklist.title,
        position: checklist.position,
        items: checklist.items.map((item) => ({
            id: item.id,
            content: item.content,
            is_done: item.isDone,
            position: item.position,
        })),
    };
}

/** CardDetailResource — o card completo, para o modal. */
export function cardDetailResource(card: CardDetailSource, viewerId: number): CardDetail {
    return {
        id: card.id,
        board_id: card.boardId,
        board_list_id: card.boardListId,
        list_title: card.list.title,
        title: card.title,
        description: card.description,
        cover_color: card.coverColor as ColorKey | null,
        due_at: toAppIso(card.dueAt),
        completed_at: toAppIso(card.completedAt),

        // O deep link de um card arquivado continua abrindo (F5 numa aba
        // velha, um link colado no chat). Sem este campo o modal fingiria
        // que o card está na coluna, e a pessoa procuraria por ele em vão.
        archived_at: toAppIso(card.archivedAt),
        created_at: toAppIso(card.createdAt) ?? '',
        label_ids: card.labels.map((label) => label.labelId),
        member_ids: card.members.map((member) => member.userId),
        comments: card.comments.map((comment) => commentResource(comment, viewerId)),
        checklists: card.checklists.map(checklistResource),
        activities: card.activities.map((activity) => activityResource(activity, activity.user)),
    };
}

/**
 * ArchivedCardResource — o card visto da gaveta: só o que a tela de
 * arquivados precisa para a pessoa reconhecê-lo e decidir se o traz de volta.
 *
 * Nada de etiquetas, membros ou contadores — a gaveta pode ter cem linhas, e
 * carregar o card inteiro em cada uma custaria mais que a tela vale. Quem
 * quiser o resto restaura e abre o card.
 */
export function archivedCardResource(card: ArchivedCardSource): ArchivedCard {
    return {
        id: card.id,
        title: card.title,
        list_title: card.listTitle,
        due_at: toAppIso(card.dueAt),
        completed_at: toAppIso(card.completedAt),
        archived_at: toAppIso(card.archivedAt),
    };
}

/**
 * CardExportResource — o que o card tem além do que a coluna do Kanban já
 * mostra: descrição, itens de checklist e comentários.
 *
 * Título, prazo, etiquetas e responsáveis **não** se repetem aqui. A tela de
 * exportação junta este detalhe ao card que já veio dentro de `board`, e
 * duplicar tudo dobraria um payload que já carrega o quadro inteiro. (A ordem
 * das chaves é a do resource original: id, description, checklists, comments.)
 */
export function cardExportResource(card: CardExportSource): CardExportDetail {
    return {
        id: card.id,
        description: card.description,
        checklists: card.checklists.map((checklist) => ({
            title: checklist.title,
            items: checklist.items.map((item) => ({ content: item.content, is_done: item.isDone })),
        })),
        comments: card.comments.map((comment) => ({
            author: comment.author?.name ?? null,
            body: comment.body,
            created_at: toAppIso(comment.createdAt),
        })),
    };
}
