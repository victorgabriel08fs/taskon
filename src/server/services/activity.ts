import 'server-only';

import { db, type Executor } from '@/server/db';
import { activities } from '@/server/db/schema';

/**
 * O antigo `ActivityLogger`: registra um evento no feed do quadro (e,
 * opcionalmente, no do card). Quem age vem explícito — no Laravel era o
 * `Auth::id()` implícito; aqui a action passa `ctx.user.id`, e a varredura
 * automática passa `null` (ninguém clicou).
 *
 * `properties` vazio vira null, como no `$properties ?: null` original.
 */
export async function logActivity(
    entry: {
        boardId: number;
        userId: number | null;
        type: string;
        description: string;
        cardId?: number | null;
        properties?: Record<string, unknown> | null;
    },
    executor: Executor = db,
): Promise<void> {
    const properties = entry.properties && Object.keys(entry.properties).length > 0 ? entry.properties : null;

    await executor.insert(activities).values({
        boardId: entry.boardId,
        cardId: entry.cardId ?? null,
        userId: entry.userId,
        type: entry.type,
        description: entry.description,
        properties,
    });
}
