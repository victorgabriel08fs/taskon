import 'server-only';

import { and, asc, eq, inArray, isNull, max, sql } from 'drizzle-orm';
import type { ColorKey } from '@/types';
import { db, type Executor } from '@/server/db';
import {
    boardLists,
    boardUser,
    cardLabel,
    cardUser,
    cards,
    labels,
    type BoardListRow,
    type CardRow,
    type UserRow,
} from '@/server/db/schema';
import { abortIf, abortUnless, invalid } from '@/server/errors';
import { authorizeBoard } from '@/server/policies/board';
import { logActivity } from '@/server/services/activity';
import { MAX_ID } from '@/server/validation';

/**
 * Os cards: criar, editar, mover, etiquetar, atribuir, arquivar e restaurar —
 * o antigo `CardController`.
 *
 * Autorização sempre pelo AGREGADO: é o papel da pessoa no quadro do card que
 * decide (`update` = qualquer membro). Ids que chegam crus do cliente (lista
 * de destino, etiqueta, pessoa) são conferidos contra o MESMO quadro antes de
 * serem usados.
 */

type Actor = Pick<UserRow, 'id'>;

/** O card pelo id, ou 404 — o route model binding do Laravel. */
export async function cardOrFail(cardId: number, executor: Executor = db): Promise<CardRow> {
    const [card] = await executor.select().from(cards).where(eq(cards.id, cardId)).limit(1);

    abortUnless(card, 404);

    return card;
}

async function listOrFail(listId: number): Promise<BoardListRow> {
    const [list] = await db.select().from(boardLists).where(eq(boardLists.id, listId)).limit(1);

    abortUnless(list, 404);

    return list;
}

/** "Fim da fila": a maior posição da lista + 1 (1 numa lista vazia). */
async function nextPosition(listId: number, onlyAlive: boolean, executor: Executor = db): Promise<number> {
    const [last] = await executor
        .select({ position: max(cards.position) })
        .from(cards)
        .where(onlyAlive ? and(eq(cards.boardListId, listId), isNull(cards.archivedAt)) : eq(cards.boardListId, listId));

    return (last?.position ?? 0) + 1;
}

/* -------------------------------------------------------------------------- */
/* Criar e editar                                                              */
/* -------------------------------------------------------------------------- */

export async function createCard(actor: Actor, listId: number, input: { title: string }): Promise<{ id: number }> {
    const list = await listOrFail(listId);

    await authorizeBoard(actor, list.boardId, 'update');

    const card = await db.transaction(async (tx) => {
        const [created] = await tx
            .insert(cards)
            .values({
                boardId: list.boardId,
                boardListId: list.id,
                createdBy: actor.id,
                title: input.title,

                // Os arquivados contam: a posição é única na lista inteira, e
                // um card restaurado volta para o fim sem empatar com ninguém.
                position: await nextPosition(list.id, false, tx),
            })
            .returning();

        // Quem escreve a tarefa já entra como responsável. Sem isso o card
        // nasce sem dono: fica de fora do filtro "só os meus", do painel e
        // do resumo diário de quem acabou de criá-lo — e tirar o próprio
        // nome depois custa um clique, enquanto lembrar de se atribuir em
        // cada card custa a atenção que o composer inline economiza.
        await tx.insert(cardUser).values({ cardId: created!.id, userId: actor.id });

        return created!;
    });

    await logActivity({
        boardId: list.boardId,
        userId: actor.id,
        type: 'card.created',
        description: `adicionou ${card.title} em ${list.title}`,
        cardId: card.id,
    });

    return { id: card.id };
}

export interface UpdateCardInput {
    title?: string;
    description?: string | null;
    cover_color?: ColorKey | null;
    due_at?: Date | null;
    is_completed?: boolean;
}

/** Só os campos enviados mudam; `null` limpa (descrição, capa, prazo). */
export async function updateCard(actor: Actor, cardId: number, input: UpdateCardInput, now: Date = new Date()): Promise<void> {
    const card = await cardOrFail(cardId);

    await authorizeBoard(actor, card.boardId, 'update');

    const changes: Partial<typeof cards.$inferInsert> = {};

    if (input.title !== undefined) changes.title = input.title;
    if (input.description !== undefined) changes.description = input.description;
    if (input.cover_color !== undefined) changes.coverColor = input.cover_color;
    if (input.due_at !== undefined) changes.dueAt = input.due_at;
    if (input.is_completed !== undefined) changes.completedAt = input.is_completed ? now : null;

    if (Object.keys(changes).length === 0) return;

    await db.update(cards).set(changes).where(eq(cards.id, card.id));

    // Registrada sempre que a caixinha vem no pedido, com o título de ANTES
    // da edição — como sempre foi.
    if (input.is_completed !== undefined) {
        await logActivity({
            boardId: card.boardId,
            userId: actor.id,
            type: input.is_completed ? 'card.completed' : 'card.reopened',
            description: `${input.is_completed ? 'concluiu' : 'reabriu'} ${card.title}`,
            cardId: card.id,
        });
    }
}

/** Apaga de vez (comentários e checklists vão junto). Devolve o que o aviso e o redirect precisam. */
export async function deleteCard(actor: Actor, cardId: number): Promise<{ boardId: number; title: string }> {
    const card = await cardOrFail(cardId);

    await authorizeBoard(actor, card.boardId, 'update');

    await db.delete(cards).where(eq(cards.id, card.id));

    // Sem card_id: o card não existe mais, e o histórico do quadro é que
    // guarda a lembrança dele.
    await logActivity({ boardId: card.boardId, userId: actor.id, type: 'card.deleted', description: `excluiu ${card.title}` });

    return { boardId: card.boardId, title: card.title };
}

/* -------------------------------------------------------------------------- */
/* Mover                                                                       */
/* -------------------------------------------------------------------------- */

type Crossing = 'completed' | 'reopened' | null;

/**
 * O card cruzou a fronteira da coluna de conclusão?
 *
 * Só o cruzamento mexe em completed_at. Mover entre duas colunas comuns não
 * pode desmarcar um card que a pessoa concluiu no próprio card — a
 * caixinha do modal é uma decisão manual, e arrastar não deve desfazê-la.
 */
function completionCrossing(from: Pick<BoardListRow, 'id' | 'isDone'> | null, to: Pick<BoardListRow, 'id' | 'isDone'>): Crossing {
    if (from === null || from.id === to.id || from.isDone === to.isDone) return null;

    return to.isDone ? 'completed' : 'reopened';
}

/**
 * Move o card para uma lista/posição. O cliente envia a ordem completa da
 * lista de destino — o servidor só materializa o que a UI já mostrou.
 *
 * Ids forjados (de outra lista, de outro quadro, inexistentes) são ignorados
 * em silêncio: só ganha posição quem de fato está na lista de destino.
 */
export async function moveCard(
    actor: Actor,
    cardId: number,
    input: { board_list_id: number; ordered_ids: number[] },
    now: Date = new Date(),
): Promise<void> {
    const card = await cardOrFail(cardId);

    await authorizeBoard(actor, card.boardId, 'update');

    // A lista de destino tem de ser do MESMO quadro: sem isto, mover seria um
    // jeito de despejar o card no quadro de outra pessoa.
    const [toList] = await db
        .select()
        .from(boardLists)
        .where(and(eq(boardLists.id, input.board_list_id), eq(boardLists.boardId, card.boardId)))
        .limit(1);

    if (!toList) invalid('board_list_id', 'Escolha uma lista deste quadro.');

    const [fromList] = await db.select().from(boardLists).where(eq(boardLists.id, card.boardListId)).limit(1);
    const crossed = completionCrossing(fromList ?? null, toList);

    // A ordem final, id → posição. Se um id vier repetido, vale a última
    // aparição (era o efeito do laço que gravava um por um) — e colapsar aqui
    // impede que os repetidos multipliquem o trabalho do banco. Id que não é
    // inteiro ou fica fora do intervalo de um `integer` não existe, e
    // derrubaria a consulta em vez de ser ignorado como os outros forjados.
    const order = new Map<number, number>();

    input.ordered_ids.forEach((id, index) => {
        if (Number.isInteger(id) && id > 0 && id <= MAX_ID) order.set(id, index + 1);
    });

    await db.transaction(async (tx) => {
        const changes: Partial<typeof cards.$inferInsert> = { boardListId: toList.id };

        if (crossed === 'completed' && card.completedAt === null) {
            changes.completedAt = now;
        } else if (crossed === 'reopened' && card.completedAt !== null) {
            changes.completedAt = null;
        }

        await tx.update(cards).set(changes).where(eq(cards.id, card.id));

        if (order.size === 0) return;

        // Um UPDATE só, em vez de um por card: o filtro por lista é a
        // interseção com quem realmente está lá (já contando o card movido).
        // O `else` só deixa o CASE total — nenhuma linha fica sem posição.
        const positions = sql.join(
            [...order].map(([id, position]) => sql`when ${id}::integer then ${position}::double precision`),
            sql` `,
        );

        await tx
            .update(cards)
            .set({ position: sql`case ${cards.id} ${positions} else ${cards.position} end` })
            .where(and(eq(cards.boardListId, toList.id), inArray(cards.id, [...order.keys()])));
    });

    if (fromList && fromList.id !== toList.id) {
        await logActivity({
            boardId: card.boardId,
            userId: actor.id,
            type: 'card.moved',
            description: `moveu ${card.title} de ${fromList.title} para ${toList.title}`,
            cardId: card.id,
        });

        if (crossed !== null) {
            await logActivity({
                boardId: card.boardId,
                userId: actor.id,
                type: crossed === 'completed' ? 'card.completed' : 'card.reopened',
                description: `${crossed === 'completed' ? 'concluiu' : 'reabriu'} ${card.title}`,
                cardId: card.id,
            });
        }
    }
}

/* -------------------------------------------------------------------------- */
/* Etiquetas e responsáveis                                                    */
/* -------------------------------------------------------------------------- */

/** Marca ou desmarca uma etiqueta DESTE quadro (404 para a de outro quadro). */
export async function toggleCardLabel(actor: Actor, cardId: number, labelId: number): Promise<void> {
    const card = await cardOrFail(cardId);

    await authorizeBoard(actor, card.boardId, 'update');

    // Sem esta linha, qualquer membro conseguiria colar no card uma etiqueta
    // de outro quadro.
    const [label] = await db
        .select({ id: labels.id })
        .from(labels)
        .where(and(eq(labels.id, labelId), eq(labels.boardId, card.boardId)))
        .limit(1);

    abortUnless(label, 404);

    const removed = await db
        .delete(cardLabel)
        .where(and(eq(cardLabel.cardId, card.id), eq(cardLabel.labelId, label.id)))
        .returning({ id: cardLabel.id });

    if (removed.length === 0) {
        await db.insert(cardLabel).values({ cardId: card.id, labelId: label.id }).onConflictDoNothing();
    }
}

/** Atribui ou desatribui um MEMBRO do quadro (404 para quem não é). */
export async function toggleCardMember(actor: Actor, cardId: number, userId: number): Promise<void> {
    const card = await cardOrFail(cardId);

    await authorizeBoard(actor, card.boardId, 'update');

    const [member] = await db
        .select({ userId: boardUser.userId })
        .from(boardUser)
        .where(and(eq(boardUser.boardId, card.boardId), eq(boardUser.userId, userId)))
        .limit(1);

    abortUnless(member, 404);

    const removed = await db
        .delete(cardUser)
        .where(and(eq(cardUser.cardId, card.id), eq(cardUser.userId, member.userId)))
        .returning({ id: cardUser.id });

    if (removed.length === 0) {
        await db.insert(cardUser).values({ cardId: card.id, userId: member.userId }).onConflictDoNothing();
    }
}

/* -------------------------------------------------------------------------- */
/* Arquivar e restaurar                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Tira o card do quadro sem apagá-lo.
 *
 * É a mesma porta que a varredura automática usa (services/done-card-archiver);
 * o que muda é quem puxa o gatilho e o fato de que aqui não é preciso estar
 * concluído — arquivar na mão é como se guarda o que foi abandonado.
 *
 * Arquivar o que já está arquivado não faz nada (nem repete o histórico).
 */
export async function archiveCard(actor: Actor, cardId: number, now: Date = new Date()): Promise<{ boardId: number; title: string }> {
    const card = await cardOrFail(cardId);

    await authorizeBoard(actor, card.boardId, 'update');

    // O filtro `archived_at is null` no próprio UPDATE: dois cliques
    // simultâneos não arquivam (nem registram) duas vezes.
    const archived = await db
        .update(cards)
        .set({ archivedAt: now })
        .where(and(eq(cards.id, card.id), isNull(cards.archivedAt)))
        .returning({ id: cards.id });

    if (archived.length > 0) {
        await logActivity({
            boardId: card.boardId,
            userId: actor.id,
            type: 'card.archived',
            description: `arquivou ${card.title}`,
            cardId: card.id,
        });
    }

    return { boardId: card.boardId, title: card.title };
}

/**
 * Devolve o card ao quadro — reaberto e no fim da fila.
 *
 * Reabrir não é capricho: um card que voltasse ainda concluído passaria de
 * novo pelo filtro da varredura e sumiria na madrugada seguinte, e a pessoa
 * ficaria restaurando o mesmo card todo dia. Quem resgata um concluído
 * quer justamente mexer nele outra vez.
 *
 * Pela mesma razão ele não volta para a coluna de conclusão: um card aberto
 * no meio dos prontos é invisível. Volta para a primeira coluna comum, e o
 * toast diz para onde foi — o card não pode reaparecer num lugar que
 * ninguém consegue adivinhar.
 */
export async function restoreCard(
    actor: Actor,
    cardId: number,
): Promise<{ boardId: number; title: string; listTitle: string }> {
    const card = await cardOrFail(cardId);

    await authorizeBoard(actor, card.boardId, 'update');

    abortIf(card.archivedAt === null, 404);

    let [list]: (BoardListRow | undefined)[] = await db
        .select()
        .from(boardLists)
        .where(eq(boardLists.id, card.boardListId))
        .limit(1);

    if (!list || list.isDone) {
        const [firstOpen] = await db
            .select()
            .from(boardLists)
            .where(and(eq(boardLists.boardId, card.boardId), isNull(boardLists.archivedAt), eq(boardLists.isDone, false)))
            .orderBy(asc(boardLists.position), asc(boardLists.id))
            .limit(1);

        list = firstOpen ?? list;
    }

    // Quadro sem uma única coluna viva: não há para onde devolver.
    abortUnless(list, 404);

    await db
        .update(cards)
        .set({
            archivedAt: null,
            completedAt: null,
            boardListId: list.id,
            position: await nextPosition(list.id, true),
        })
        .where(eq(cards.id, card.id));

    await logActivity({
        boardId: card.boardId,
        userId: actor.id,
        type: 'card.restored',
        description: `restaurou ${card.title} em ${list.title}`,
        cardId: card.id,
    });

    return { boardId: card.boardId, title: card.title, listTitle: list.title };
}
