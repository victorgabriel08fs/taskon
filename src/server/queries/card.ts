import 'server-only';

import { and, desc, eq, isNotNull } from 'drizzle-orm';
import type { ArchivedCard, CardDetail, CardExportDetail } from '@/types';
import { config } from '@/server/config';
import { db } from '@/server/db';
import { boardLists, cards, type UserRow } from '@/server/db/schema';
import { abortUnless } from '@/server/errors';
import { authorizeBoard } from '@/server/policies/board';
import { archivedCardResource, cardDetailResource, cardExportResource } from '@/server/resources/card';

/**
 * Os carregamentos em torno do card: o modal (o antigo `activeCard` do
 * BoardController@show), a gaveta de arquivados e o detalhe da exportação
 * (as antigas props `optional` `archivedCards` e `exportDetails`).
 *
 * Todos exigem `view` no quadro: 404 se ele não existe, 403 para quem não é
 * membro.
 */

/** Só o que o UserResource mostra — o hash da senha nunca sai do banco à toa. */
const userColumns = { id: true, name: true, email: true, avatarColor: true, title: true } as const;

/**
 * O card aberto no modal, por deep link (`/boards/1/cards/42`).
 *
 * Card de outro quadro é 404, como se não existisse: o id na URL não pode ser
 * um jeito de espiar o quadro alheio pela porta do quadro próprio. Já o card
 * ARQUIVADO abre normalmente — F5 numa aba velha, um link colado no chat — e
 * o modal avisa que ele saiu das colunas (`archived_at`).
 */
export async function loadCardDetail(user: Pick<UserRow, 'id'>, boardId: number, cardId: number): Promise<CardDetail> {
    await authorizeBoard(user, boardId, 'view');

    const card = await db.query.cards.findFirst({
        where: (card, { and, eq }) => and(eq(card.id, cardId), eq(card.boardId, boardId)),
        with: {
            list: { columns: { title: true } },

            // Só os ids: o objeto completo de etiquetas e membros já vem no
            // quadro, e o modal os casa por id.
            labels: { columns: { labelId: true }, orderBy: (pivot, { asc }) => [asc(pivot.id)] },
            members: { columns: { userId: true }, orderBy: (pivot, { asc }) => [asc(pivot.id)] },

            // Conversa do mais recente para o mais antigo (o `latest()` da
            // relação no model).
            comments: {
                orderBy: (comment, { desc }) => [desc(comment.createdAt), desc(comment.id)],
                with: { author: { columns: userColumns } },
            },
            checklists: {
                orderBy: (checklist, { asc }) => [asc(checklist.position), asc(checklist.id)],
                with: { items: { orderBy: (item, { asc }) => [asc(item.position), asc(item.id)] } },
            },
            activities: {
                orderBy: (activity, { desc }) => [desc(activity.createdAt), desc(activity.id)],
                limit: config.limits.activitiesPerCard,
                with: { user: { columns: userColumns } },
            },
        },
    });

    abortUnless(card, 404);

    return cardDetailResource(card, user.id);
}

/**
 * A gaveta de arquivados: os mais recentes primeiro, até o teto da config.
 *
 * É lida a CADA abertura da gaveta (e devolvida de novo por restaurar e por
 * "Arquivar agora"): arquivar e restaurar mudam a lista, e uma cópia velha
 * ofereceria "Restaurar" num card que já voltou para a coluna.
 */
export async function loadArchivedCards(user: Pick<UserRow, 'id'>, boardId: number): Promise<ArchivedCard[]> {
    await authorizeBoard(user, boardId, 'view');

    const rows = await db
        .select({
            id: cards.id,
            title: cards.title,
            dueAt: cards.dueAt,
            completedAt: cards.completedAt,
            archivedAt: cards.archivedAt,
            listTitle: boardLists.title,
        })
        .from(cards)
        .leftJoin(boardLists, eq(boardLists.id, cards.boardListId))
        .where(and(eq(cards.boardId, boardId), isNotNull(cards.archivedAt)))
        .orderBy(desc(cards.archivedAt), desc(cards.id))
        .limit(config.limits.archivedPerBoard);

    return rows.map(archivedCardResource);
}

/**
 * O detalhe da exportação: descrição, checklists e comentários de todos os
 * cards VIVOS do quadro. Só é lido quando alguém abre a exportação — carregar
 * isso a cada visita ao quadro seria pagar o preço dela sem usá-la.
 *
 * Só as colunas que faltam: o resto do card já está no quadro, e o cliente
 * casa os dois pelo `id`.
 */
export async function loadExportDetails(user: Pick<UserRow, 'id'>, boardId: number): Promise<CardExportDetail[]> {
    await authorizeBoard(user, boardId, 'view');

    const rows = await db.query.cards.findMany({
        columns: { id: true, description: true },
        where: (card, { and, eq, isNull }) => and(eq(card.boardId, boardId), isNull(card.archivedAt)),
        orderBy: (card, { asc }) => [asc(card.id)],
        with: {
            checklists: {
                columns: { title: true },
                orderBy: (checklist, { asc }) => [asc(checklist.position), asc(checklist.id)],
                with: {
                    items: {
                        columns: { content: true, isDone: true },
                        orderBy: (item, { asc }) => [asc(item.position), asc(item.id)],
                    },
                },
            },

            // No modal a conversa vem do mais recente para o mais antigo; no
            // texto exportado ela faz sentido do começo para o fim.
            comments: {
                columns: { body: true, createdAt: true },
                orderBy: (comment, { asc }) => [asc(comment.createdAt), asc(comment.id)],
                with: { author: { columns: { name: true } } },
            },
        },
    });

    return rows.map(cardExportResource);
}
