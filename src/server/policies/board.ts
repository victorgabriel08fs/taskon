import 'server-only';

import { and, eq } from 'drizzle-orm';
import type { BoardRole } from '@/types';
import { db, type Executor } from '@/server/db';
import { boardUser, boards, type BoardRow, type UserRow } from '@/server/db/schema';
import { abort } from '@/server/errors';

/**
 * O antigo `BoardPolicy`. Autorização sempre pelo AGREGADO: card, lista,
 * etiqueta, comentário e checklist pertencem a um quadro, e é o papel da
 * pessoa nesse quadro que decide.
 *
 *  - view / update → qualquer membro (ver e editar conteúdo);
 *  - manage        → owner ou admin (configurações, etiquetas, membros);
 *  - delete        → só o dono (owner_id do quadro).
 */
export type BoardAbility = 'view' | 'update' | 'manage' | 'delete';

/** Papel do usuário no quadro, ou null se não for membro. */
export async function roleOf(userId: number, boardId: number, executor: Executor = db): Promise<BoardRole | null> {
    const [row] = await executor
        .select({ role: boardUser.role })
        .from(boardUser)
        .where(and(eq(boardUser.boardId, boardId), eq(boardUser.userId, userId)))
        .limit(1);

    return (row?.role as BoardRole | undefined) ?? null;
}

/** A regra pura, para quando o papel já está em mãos (sem nova consulta). */
export function allows(ability: BoardAbility, role: BoardRole | null, board: Pick<BoardRow, 'ownerId'>, userId: number): boolean {
    switch (ability) {
        case 'view':
        case 'update':
            return role !== null;
        case 'manage':
            return role === 'owner' || role === 'admin';
        case 'delete':
            return board.ownerId === userId;
    }
}

/**
 * Carrega o quadro e confirma a permissão: 404 se ele não existe, 403 se a
 * pessoa não pode. É o `$this->authorize()` dos controllers.
 */
export async function authorizeBoard(
    user: Pick<UserRow, 'id'>,
    boardId: number,
    ability: BoardAbility,
    executor: Executor = db,
): Promise<{ board: BoardRow; role: BoardRole | null }> {
    const [board] = await executor.select().from(boards).where(eq(boards.id, boardId)).limit(1);

    if (!board) abort(404);

    const role = await roleOf(user.id, board.id, executor);

    if (!allows(ability, role, board, user.id)) abort(403);

    return { board, role };
}

/** As duas permissões que a tela do quadro precisa saber (o `can` do BoardResource). */
export function boardCan(role: BoardRole | null, board: Pick<BoardRow, 'ownerId'>, userId: number) {
    return {
        manage: allows('manage', role, board, userId),
        delete: allows('delete', role, board, userId),
    };
}
