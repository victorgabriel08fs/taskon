import 'server-only';

import { eq } from 'drizzle-orm';
import { db } from '@/server/db';
import { cards, comments, type UserRow } from '@/server/db/schema';
import { abortUnless } from '@/server/errors';
import { authorizeBoard } from '@/server/policies/board';
import { logActivity } from '@/server/services/activity';
import { cardOrFail } from '@/server/services/cards';

/**
 * Comentários do card — o antigo `CommentController`. Qualquer membro do
 * quadro comenta; só o autor apaga o próprio comentário.
 */

type Actor = Pick<UserRow, 'id'>;

export async function addComment(actor: Actor, cardId: number, input: { body: string }): Promise<{ id: number }> {
    const card = await cardOrFail(cardId);

    await authorizeBoard(actor, card.boardId, 'update');

    const [comment] = await db
        .insert(comments)
        .values({ cardId: card.id, userId: actor.id, body: input.body })
        .returning({ id: comments.id });

    await logActivity({
        boardId: card.boardId,
        userId: actor.id,
        type: 'comment.created',
        description: `comentou em ${card.title}`,
        cardId: card.id,
    });

    return { id: comment!.id };
}

/** 404 se sumiu; 403 para quem não é membro do quadro OU não é o autor. */
export async function deleteComment(actor: Actor, commentId: number): Promise<void> {
    const [comment] = await db
        .select({ id: comments.id, userId: comments.userId, boardId: cards.boardId })
        .from(comments)
        .innerJoin(cards, eq(cards.id, comments.cardId))
        .where(eq(comments.id, commentId))
        .limit(1);

    abortUnless(comment, 404);

    await authorizeBoard(actor, comment.boardId, 'update');

    // Ser membro dá direito a comentar, não a apagar a fala dos outros.
    abortUnless(comment.userId === actor.id, 403);

    await db.delete(comments).where(eq(comments.id, comment.id));
}
