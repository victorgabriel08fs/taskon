import 'server-only';

import { and, eq, inArray, isNull, max } from 'drizzle-orm';
import { db } from '@/server/db';
import { boardLists, cards, type BoardListRow, type UserRow } from '@/server/db/schema';
import { abort } from '@/server/errors';
import { authorizeBoard } from '@/server/policies/board';
import { logActivity } from '@/server/services/activity';

/**
 * Listas (colunas) — o antigo `BoardListController`. Mexer em coluna é mexer
 * no conteúdo do quadro: qualquer membro pode (`update`).
 */

/** O maior valor de uma coluna `integer` do Postgres. */
const MAX_ID = 2_147_483_647;

/** Id que pode existir no banco; o resto nem vale a consulta. */
const isRowId = (value: number) => Number.isInteger(value) && value > 0 && value <= MAX_ID;

/** A lista pelo id, ou 404 (o route model binding do Laravel). */
async function findList(listId: number): Promise<BoardListRow> {
    const [list] = await db.select().from(boardLists).where(eq(boardLists.id, listId)).limit(1);

    if (!list) abort(404);

    return list;
}

/** Nova coluna no fim do quadro. */
export async function createList(
    actor: Pick<UserRow, 'id'>,
    boardId: number,
    input: { title: string },
): Promise<BoardListRow> {
    const { board } = await authorizeBoard(actor, boardId, 'update');

    // Fim da fila: maior posição entre TODAS as listas do quadro + 1 (1 no
    // quadro vazio).
    const [last] = await db
        .select({ position: max(boardLists.position) })
        .from(boardLists)
        .where(eq(boardLists.boardId, board.id));

    const [list] = await db
        .insert(boardLists)
        .values({ boardId: board.id, title: input.title, position: (last?.position ?? 0) + 1 })
        .returning();

    return list!;
}

export interface ListChanges {
    title?: string;
    /** `null` tira o limite. */
    card_limit?: number | null;
    /** Soltar um card numa coluna `is_done` marca `completed_at`. */
    is_done?: boolean;
}

/** Só os campos enviados mudam. */
export async function updateList(
    actor: Pick<UserRow, 'id'>,
    listId: number,
    input: ListChanges,
    now: Date = new Date(),
): Promise<void> {
    const list = await findList(listId);

    await authorizeBoard(actor, list.boardId, 'update');

    // Só o que mudou de fato (o "dirty" do Eloquent).
    const changes: Partial<typeof boardLists.$inferInsert> = {};

    if (input.title !== undefined && input.title !== list.title) changes.title = input.title;
    if (input.card_limit !== undefined && input.card_limit !== list.cardLimit) changes.cardLimit = input.card_limit;
    if (input.is_done !== undefined && input.is_done !== list.isDone) changes.isDone = input.is_done;

    if (Object.keys(changes).length === 0) return;

    const becameDone = changes.isDone === true;

    await db.transaction(async (tx) => {
        await tx.update(boardLists).set(changes).where(eq(boardLists.id, list.id));

        // Marcar a coluna depois de ela já estar cheia precisa alcançar quem
        // está lá dentro: senão a pessoa marca "Concluído" e os cards continuam
        // contando como abertos (e vencidos) no painel.
        if (becameDone) {
            await tx
                .update(cards)
                .set({ completedAt: now })
                .where(and(eq(cards.boardListId, list.id), isNull(cards.completedAt), isNull(cards.archivedAt)));
        }
    });
}

/** Remove a coluna e, com ela, os cards dela (ON DELETE CASCADE). */
export async function deleteList(actor: Pick<UserRow, 'id'>, listId: number): Promise<void> {
    const list = await findList(listId);
    const { board } = await authorizeBoard(actor, list.boardId, 'update');

    await db.transaction(async (tx) => {
        await tx.delete(boardLists).where(eq(boardLists.id, list.id));

        await logActivity(
            { boardId: board.id, userId: actor.id, type: 'list.deleted', description: `removeu a lista ${list.title}` },
            tx,
        );
    });
}

/**
 * Reordena as colunas. O cliente manda a ordem final inteira: idempotente e
 * imune a divergências de índice depois de um arraste. Ids que não são listas
 * deste quadro são ignorados em silêncio.
 */
export async function reorderLists(actor: Pick<UserRow, 'id'>, boardId: number, orderedIds: number[]): Promise<void> {
    const { board } = await authorizeBoard(actor, boardId, 'update');

    const candidates = [...new Set(orderedIds.filter(isRowId))];

    if (candidates.length === 0) return;

    const owned = await db
        .select({ id: boardLists.id })
        .from(boardLists)
        .where(and(eq(boardLists.boardId, board.id), inArray(boardLists.id, candidates)));

    const allowed = new Set(owned.map((row) => row.id));

    if (allowed.size === 0) return;

    await db.transaction(async (tx) => {
        for (const [index, id] of orderedIds.entries()) {
            if (!allowed.has(id)) continue;

            await tx
                .update(boardLists)
                .set({ position: index + 1 })
                .where(and(eq(boardLists.id, id), eq(boardLists.boardId, board.id)));
        }
    });
}
