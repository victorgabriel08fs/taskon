import 'server-only';

import { eq, max } from 'drizzle-orm';
import { db } from '@/server/db';
import { cards, checklistItems, checklists, type UserRow } from '@/server/db/schema';
import { abortUnless } from '@/server/errors';
import { authorizeBoard } from '@/server/policies/board';
import { cardOrFail } from '@/server/services/cards';

/**
 * Checklists do card e seus itens — o antigo `ChecklistController`. Sem
 * histórico: marcar item é miúdo demais para o feed do quadro.
 *
 * A autorização sobe até o quadro pelo card (item → checklist → card → quadro).
 */

type Actor = Pick<UserRow, 'id'>;

/** A checklist e o quadro a que ela pertence, ou 404. */
async function checklistOrFail(checklistId: number): Promise<{ id: number; boardId: number }> {
    const [checklist] = await db
        .select({ id: checklists.id, boardId: cards.boardId })
        .from(checklists)
        .innerJoin(cards, eq(cards.id, checklists.cardId))
        .where(eq(checklists.id, checklistId))
        .limit(1);

    abortUnless(checklist, 404);

    return checklist;
}

/** O item e o quadro a que ele pertence, ou 404. */
async function itemOrFail(itemId: number): Promise<{ id: number; boardId: number }> {
    const [item] = await db
        .select({ id: checklistItems.id, boardId: cards.boardId })
        .from(checklistItems)
        .innerJoin(checklists, eq(checklists.id, checklistItems.checklistId))
        .innerJoin(cards, eq(cards.id, checklists.cardId))
        .where(eq(checklistItems.id, itemId))
        .limit(1);

    abortUnless(item, 404);

    return item;
}

/** Nova checklist no fim do card. */
export async function addChecklist(actor: Actor, cardId: number, input: { title: string }): Promise<{ id: number }> {
    const card = await cardOrFail(cardId);

    await authorizeBoard(actor, card.boardId, 'update');

    const [last] = await db
        .select({ position: max(checklists.position) })
        .from(checklists)
        .where(eq(checklists.cardId, card.id));

    const [checklist] = await db
        .insert(checklists)
        .values({ cardId: card.id, title: input.title, position: (last?.position ?? 0) + 1 })
        .returning({ id: checklists.id });

    return { id: checklist!.id };
}

/** Apaga a checklist com todos os itens. */
export async function deleteChecklist(actor: Actor, checklistId: number): Promise<void> {
    const checklist = await checklistOrFail(checklistId);

    await authorizeBoard(actor, checklist.boardId, 'update');

    await db.delete(checklists).where(eq(checklists.id, checklist.id));
}

/** Novo item no fim da checklist. */
export async function addChecklistItem(actor: Actor, checklistId: number, input: { content: string }): Promise<{ id: number }> {
    const checklist = await checklistOrFail(checklistId);

    await authorizeBoard(actor, checklist.boardId, 'update');

    const [last] = await db
        .select({ position: max(checklistItems.position) })
        .from(checklistItems)
        .where(eq(checklistItems.checklistId, checklist.id));

    const [item] = await db
        .insert(checklistItems)
        .values({ checklistId: checklist.id, content: input.content, position: (last?.position ?? 0) + 1 })
        .returning({ id: checklistItems.id });

    return { id: item!.id };
}

/** Só os campos enviados mudam: o texto, a caixinha, ou os dois. */
export async function updateChecklistItem(
    actor: Actor,
    itemId: number,
    input: { content?: string; is_done?: boolean },
): Promise<void> {
    const item = await itemOrFail(itemId);

    await authorizeBoard(actor, item.boardId, 'update');

    const changes: Partial<typeof checklistItems.$inferInsert> = {};

    if (input.content !== undefined) changes.content = input.content;
    if (input.is_done !== undefined) changes.isDone = input.is_done;

    if (Object.keys(changes).length === 0) return;

    await db.update(checklistItems).set(changes).where(eq(checklistItems.id, item.id));
}

export async function deleteChecklistItem(actor: Actor, itemId: number): Promise<void> {
    const item = await itemOrFail(itemId);

    await authorizeBoard(actor, item.boardId, 'update');

    await db.delete(checklistItems).where(eq(checklistItems.id, item.id));
}
