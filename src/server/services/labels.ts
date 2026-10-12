import 'server-only';

import { eq } from 'drizzle-orm';
import type { ColorKey } from '@/types';
import { db } from '@/server/db';
import { labels, type LabelRow, type UserRow } from '@/server/db/schema';
import { abortUnless } from '@/server/errors';
import { authorizeBoard } from '@/server/policies/board';

/**
 * Etiquetas do quadro — o antigo `LabelController`. Criar, renomear e apagar
 * é configuração do quadro: só owner/admin (`manage`). Marcar uma etiqueta
 * num card é conteúdo, e fica com qualquer membro (ver `toggleCardLabel`).
 */

type Actor = Pick<UserRow, 'id'>;

async function labelOrFail(labelId: number): Promise<LabelRow> {
    const [label] = await db.select().from(labels).where(eq(labels.id, labelId)).limit(1);

    abortUnless(label, 404);

    return label;
}

/** Nome é opcional: a cor sozinha já é uma etiqueta ("Sem nome" na tela). */
export async function createLabel(
    actor: Actor,
    boardId: number,
    input: { name: string | null; color: ColorKey },
): Promise<{ id: number }> {
    await authorizeBoard(actor, boardId, 'manage');

    const [label] = await db
        .insert(labels)
        .values({ boardId, name: input.name, color: input.color })
        .returning({ id: labels.id });

    return { id: label!.id };
}

/** Só os campos enviados mudam; `name: null` tira o nome. */
export async function updateLabel(
    actor: Actor,
    labelId: number,
    input: { name?: string | null; color?: ColorKey },
): Promise<void> {
    const label = await labelOrFail(labelId);

    await authorizeBoard(actor, label.boardId, 'manage');

    const changes: Partial<typeof labels.$inferInsert> = {};

    if (input.name !== undefined) changes.name = input.name;
    if (input.color !== undefined) changes.color = input.color;

    if (Object.keys(changes).length === 0) return;

    await db.update(labels).set(changes).where(eq(labels.id, label.id));
}

/** Some também de todos os cards que a usavam. */
export async function deleteLabel(actor: Actor, labelId: number): Promise<void> {
    const label = await labelOrFail(labelId);

    await authorizeBoard(actor, label.boardId, 'manage');

    await db.delete(labels).where(eq(labels.id, label.id));
}
