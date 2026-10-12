import 'server-only';

import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Activity, AutoArchiveConfig, Board, BoardBackground, ColorKey, User } from '@/types';
import { BACKGROUNDS, COLORS, config } from '@/server/config';
import { db } from '@/server/db';
import {
    activities,
    boardLists,
    boardUser,
    boards,
    cardLabel,
    cardUser,
    cards,
    checklistItems,
    checklists,
    comments,
    labels,
    users,
    type UserRow,
} from '@/server/db/schema';
import { abortUnless } from '@/server/errors';
import { authorizeBoard, boardCan } from '@/server/policies/board';
import { activityResource, labelResource, userResource } from '@/server/resources/common';
import { boardListResource, boardResource, cardResource } from '@/server/resources/board';

/**
 * A tela do quadro — o antigo `BoardController@show` (sem o card aberto, a
 * exportação e a gaveta de arquivados, que moram em queries/card.ts).
 *
 * O payload inteiro sai de um punhado FIXO de consultas, não importa quantos
 * cards o quadro tenha: listas, cards, etiquetas e responsáveis vêm em lotes, e
 * os contadores de cada card (comentários, itens de checklist) são subconsultas
 * correlacionadas da própria consulta dos cards — o `withCount` do Eloquent.
 */

export interface BoardPageData {
    /** BoardResource completo: listas → cards não arquivados, etiquetas, membros, permissões. */
    board: Board;
    backgrounds: BoardBackground[];
    colors: ColorKey[];

    // Prazos e horário da varredura vêm do servidor porque é ele quem os
    // valida e os executa: a tela não pode oferecer um prazo que o backend
    // recusa, nem prometer um horário que o agendador não tem.
    autoArchive: AutoArchiveConfig;
}

/** Um membro de quadro: a pessoa e a linha dela em board_user. */
export interface BoardMembership {
    boardId: number;
    role: string;
    isFavorite: boolean;
    user: Pick<UserRow, 'id' | 'name' | 'email' | 'avatarColor' | 'title'>;
}

/** O maior valor de uma coluna `integer` do Postgres. */
const MAX_ID = 2_147_483_647;

/**
 * Id vindo da URL que nem pode existir (NaN, fracionário, fora do `integer`)
 * é "não encontrado" — e não um erro de banco virando 500.
 */
function assertBoardId(boardId: number): void {
    abortUnless(Number.isInteger(boardId) && boardId > 0 && boardId <= MAX_ID, 404);
}

/**
 * Membros dos quadros com o papel de cada um, na ordem em que entraram
 * (board_user.id) — o dono, que entra na criação, vem primeiro.
 */
export async function loadBoardMemberships(boardIds: number[]): Promise<Map<number, BoardMembership[]>> {
    const byBoard = new Map<number, BoardMembership[]>();

    if (boardIds.length === 0) return byBoard;

    const rows = await db
        .select({
            boardId: boardUser.boardId,
            role: boardUser.role,
            isFavorite: boardUser.isFavorite,
            user: {
                id: users.id,
                name: users.name,
                email: users.email,
                avatarColor: users.avatarColor,
                title: users.title,
            },
        })
        .from(boardUser)
        .innerJoin(users, eq(users.id, boardUser.userId))
        .where(inArray(boardUser.boardId, boardIds))
        .orderBy(asc(boardUser.id));

    for (const row of rows) {
        const list = byBoard.get(row.boardId) ?? [];

        list.push(row);
        byBoard.set(row.boardId, list);
    }

    return byBoard;
}

/** UserResource com o papel do pivô — como o `members` do quadro sai para a tela. */
export function memberResources(memberships: BoardMembership[]): User[] {
    return memberships.map((membership) => userResource(membership.user, membership.role));
}

/** Agrupa pares (card, outro id) em `card → [ids]`, preservando a ordem da consulta. */
function groupIds<T extends { cardId: number }>(rows: T[], pick: (row: T) => number): Map<number, number[]> {
    const grouped = new Map<number, number[]>();

    for (const row of rows) {
        const ids = grouped.get(row.cardId) ?? [];

        ids.push(pick(row));
        grouped.set(row.cardId, ids);
    }

    return grouped;
}

/**
 * Itens de checklist com o card de cada um — o `hasManyThrough` checklistItems
 * do model Card, que só existia para contar sem carregar as checklists.
 */
const checklistItemsWithCard = sql`${checklistItems} inner join ${checklists} on ${eq(checklists.id, checklistItems.checklistId)}`;

export async function loadBoardPage(user: Pick<UserRow, 'id'>, boardId: number): Promise<BoardPageData> {
    assertBoardId(boardId);

    const { board, role } = await authorizeBoard(user, boardId, 'view');

    // Cards das colunas vivas: o que o Eloquent carregava via lists → cards.
    const liveLists = db
        .select({ id: boardLists.id })
        .from(boardLists)
        .where(and(eq(boardLists.boardId, board.id), isNull(boardLists.archivedAt)));
    const liveCards = and(inArray(cards.boardListId, liveLists), isNull(cards.archivedAt));

    // Consultas independentes entre si: vão juntas, em vez de uma esperando a outra.
    const [memberships, labelRows, listRows, cardRows, labelLinks, memberLinks, archivedCount] = await Promise.all([
        loadBoardMemberships([board.id]),
        db
            .select({ id: labels.id, name: labels.name, color: labels.color })
            .from(labels)
            .where(eq(labels.boardId, board.id))
            .orderBy(asc(labels.id)),
        db
            .select({
                id: boardLists.id,
                title: boardLists.title,
                position: boardLists.position,
                cardLimit: boardLists.cardLimit,
                isDone: boardLists.isDone,
            })
            .from(boardLists)
            .where(and(eq(boardLists.boardId, board.id), isNull(boardLists.archivedAt)))
            .orderBy(asc(boardLists.position), asc(boardLists.id)),
        db
            .select({
                id: cards.id,
                boardListId: cards.boardListId,
                title: cards.title,
                position: cards.position,
                coverColor: cards.coverColor,
                dueAt: cards.dueAt,
                completedAt: cards.completedAt,
                description: cards.description,
                commentsCount: db.$count(comments, eq(comments.cardId, cards.id)),
                checklistTotal: db.$count(checklistItemsWithCard, eq(checklists.cardId, cards.id)),
                checklistDone: db.$count(
                    checklistItemsWithCard,
                    and(eq(checklists.cardId, cards.id), eq(checklistItems.isDone, true)),
                ),
            })
            .from(cards)
            .where(liveCards)
            .orderBy(asc(cards.position), asc(cards.id)),

        // Só os ids: os objetos completos já vão em `board.labels`/`board.members`.
        db
            .select({ cardId: cardLabel.cardId, labelId: cardLabel.labelId })
            .from(cardLabel)
            .innerJoin(cards, eq(cards.id, cardLabel.cardId))
            .where(liveCards)
            .orderBy(asc(cardLabel.id)),
        db
            .select({ cardId: cardUser.cardId, userId: cardUser.userId })
            .from(cardUser)
            .innerJoin(cards, eq(cards.id, cardUser.cardId))
            .where(liveCards)
            .orderBy(asc(cardUser.id)),

        // Só o número: é ele que decide se o menu do quadro mostra a gaveta de
        // arquivados, e a lista em si só é lida quando alguém a abre.
        db.$count(cards, and(eq(cards.boardId, board.id), isNotNull(cards.archivedAt))),
    ]);

    await db
        .update(boardUser)
        .set({ lastOpenedAt: new Date() })
        .where(and(eq(boardUser.boardId, board.id), eq(boardUser.userId, user.id)));

    const members = memberships.get(board.id) ?? [];
    const labelIds = groupIds(labelLinks, (link) => link.labelId);
    const memberIds = groupIds(memberLinks, (link) => link.userId);
    const cardsByList = new Map<number, typeof cardRows>();

    for (const card of cardRows) {
        const list = cardsByList.get(card.boardListId) ?? [];

        list.push(card);
        cardsByList.set(card.boardListId, list);
    }

    return {
        board: boardResource(board, {
            role,
            isFavorite: members.find((member) => member.user.id === user.id)?.isFavorite ?? false,
            can: boardCan(role, board, user.id),
            archivedCount,
            members: memberResources(members),
            labels: labelRows.map(labelResource),
            lists: listRows.map((list) =>
                boardListResource(
                    list,
                    (cardsByList.get(list.id) ?? []).map((card) =>
                        cardResource({
                            ...card,
                            labelIds: labelIds.get(card.id) ?? [],
                            memberIds: memberIds.get(card.id) ?? [],
                        }),
                    ),
                ),
            ),
        }),
        backgrounds: [...BACKGROUNDS],
        colors: [...COLORS],
        autoArchive: { at: config.autoArchive.at, options: [...config.autoArchive.options] },
    };
}

/**
 * O histórico do quadro — o antigo `Inertia::defer` de `activity`. Os mais
 * recentes primeiro, com quem fez; sem a chave `board` (aqui o feed é de um
 * quadro só).
 */
export async function loadBoardActivity(user: Pick<UserRow, 'id'>, boardId: number): Promise<Activity[]> {
    assertBoardId(boardId);

    const { board } = await authorizeBoard(user, boardId, 'view');

    const rows = await db
        .select({
            activity: {
                id: activities.id,
                type: activities.type,
                description: activities.description,
                properties: activities.properties,
                createdAt: activities.createdAt,
            },
            user: {
                id: users.id,
                name: users.name,
                email: users.email,
                avatarColor: users.avatarColor,
                title: users.title,
            },
        })
        .from(activities)
        .leftJoin(users, eq(users.id, activities.userId))
        .where(eq(activities.boardId, board.id))
        .orderBy(desc(activities.createdAt), desc(activities.id))
        .limit(config.limits.activitiesPerBoard);

    return rows.map((row) => activityResource(row.activity, row.user));
}

/**
 * Só o título, para o `generateMetadata`. Nunca lança: quadro inexistente ou
 * de que a pessoa não participa dá null, e a página decide entre 404 e 403.
 */
export async function loadBoardTitle(user: Pick<UserRow, 'id'>, boardId: number): Promise<string | null> {
    if (!Number.isInteger(boardId) || boardId <= 0 || boardId > MAX_ID) return null;

    // Ver o quadro = ser membro dele (BoardPolicy::view).
    const [row] = await db
        .select({ title: boards.title })
        .from(boards)
        .innerJoin(boardUser, and(eq(boardUser.boardId, boards.id), eq(boardUser.userId, user.id)))
        .where(eq(boards.id, boardId))
        .limit(1);

    return row?.title ?? null;
}
