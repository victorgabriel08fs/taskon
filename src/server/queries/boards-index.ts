import 'server-only';

import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { BoardBackground, BoardSummary } from '@/types';
import { BACKGROUNDS } from '@/server/config';
import { db } from '@/server/db';
import { boardLists, boardUser, boards, cards, type UserRow } from '@/server/db/schema';
import { loadBoardMemberships, memberResources } from '@/server/queries/board';
import { counted } from '@/server/queries/scopes';
import { boardSummaryResource } from '@/server/resources/board';

/**
 * A lista de quadros do usuário, favoritos primeiro — o antigo
 * `BoardController@index`. Os números agregados (e os gráficos) ficam no
 * painel.
 */
export async function loadBoardsIndex(
    user: Pick<UserRow, 'id'>,
): Promise<{ boards: BoardSummary[]; backgrounds: BoardBackground[] }> {
    const rows = await db
        .select({
            id: boards.id,
            title: boards.title,
            description: boards.description,
            background: boards.background,
            role: boardUser.role,
            isFavorite: boardUser.isFavorite,
            lastOpenedAt: boardUser.lastOpenedAt,
            listsCount: db.$count(boardLists, and(eq(boardLists.boardId, boards.id), isNull(boardLists.archivedAt))),

            // `counted()` e não "não arquivado": a barra de progresso do card do
            // quadro é done/total, e sem isso arquivar os concluídos a jogaria
            // de 100% para 0%. Ver `counted` em queries/scopes.ts.
            cardsCount: db.$count(cards, and(eq(cards.boardId, boards.id), counted())),
            doneCount: db.$count(cards, and(eq(cards.boardId, boards.id), isNotNull(cards.completedAt))),
        })
        .from(boardUser)
        .innerJoin(boards, eq(boards.id, boardUser.boardId))
        .where(and(eq(boardUser.userId, user.id), isNull(boards.archivedAt)))
        .orderBy(
            desc(boardUser.isFavorite),
            // O MySQL punha os nulos (quadro nunca aberto) no FIM de um DESC; o
            // Postgres os põe no começo. `nulls last` mantém a ordem antiga.
            sql`${boardUser.lastOpenedAt} desc nulls last`,
            desc(boards.createdAt),
            // Desempate estável para quadros criados no mesmo instante.
            desc(boards.id),
        );

    const memberships = await loadBoardMemberships(rows.map((row) => row.id));

    return {
        boards: rows.map((row) => boardSummaryResource(row, memberResources(memberships.get(row.id) ?? []))),
        backgrounds: [...BACKGROUNDS],
    };
}
