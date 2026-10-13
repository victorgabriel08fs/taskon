import 'server-only';

import type {
    Board,
    BoardBackground,
    BoardInvitation,
    BoardList,
    BoardRole,
    BoardSummary,
    Card,
    ColorKey,
    Label,
    User,
} from '@/types';
import { toAppIso } from '@/lib/timezone';
import type { BoardListRow, BoardRow, CardRow } from '@/server/db/schema';

/**
 * Os resources do quadro: BoardResource, BoardListResource, CardResource e
 * BoardSummaryResource. Como em `common.ts`, cada função devolve EXATAMENTE o
 * tipo de `@/types` que a tela consome — nada de linha crua do banco.
 *
 * Os números agregados (contadores, papel, favorito) chegam prontos da
 * consulta: o resource só dá forma, nunca consulta. É o que mantém o payload
 * do quadro livre de N+1 (ver src/server/queries/board.ts).
 */

/* -------------------------------------------------------------------------- */
/* Card (a versão leve, do Kanban)                                             */
/* -------------------------------------------------------------------------- */

/** O que a coluna precisa contar e marcar sem carregar o card inteiro. */
export interface CardExtras {
    labelIds: number[];
    memberIds: number[];
    commentsCount: number;
    checklistTotal: number;
    checklistDone: number;
}

export type CardSource = Pick<
    CardRow,
    'id' | 'boardListId' | 'title' | 'position' | 'coverColor' | 'dueAt' | 'completedAt' | 'description'
> &
    Partial<CardExtras>;

/** O `filled()` do Laravel: nulo ou só espaços conta como vazio. */
function filled(value: string | null): boolean {
    return value !== null && value.trim() !== '';
}

/**
 * Versão "leve" do card — o que o Kanban precisa para desenhar a coluna. O
 * detalhe completo vai no CardDetail, carregado só ao abrir o card.
 *
 * Etiquetas e responsáveis vão só como ids: os objetos completos já estão em
 * `board.labels` e `board.members`, e repetir a mesma etiqueta em quarenta
 * cards só engordaria o payload. Sem os extras, saem vazios/zerados (o
 * `whenLoaded(..., [])` e o `?? 0` do original).
 */
export function cardResource(card: CardSource): Card {
    return {
        id: card.id,
        board_list_id: card.boardListId,
        title: card.title,
        position: card.position,
        cover_color: card.coverColor as ColorKey | null,
        due_at: toAppIso(card.dueAt),
        completed_at: toAppIso(card.completedAt),
        has_description: filled(card.description),
        label_ids: card.labelIds ?? [],
        member_ids: card.memberIds ?? [],
        comments_count: card.commentsCount ?? 0,
        checklist_total: card.checklistTotal ?? 0,
        checklist_done: card.checklistDone ?? 0,
    };
}

/* -------------------------------------------------------------------------- */
/* Lista (coluna)                                                              */
/* -------------------------------------------------------------------------- */

export type BoardListSource = Pick<BoardListRow, 'id' | 'title' | 'position' | 'cardLimit' | 'isDone'>;

export function boardListResource(list: BoardListSource, cards: Card[] = []): BoardList {
    return {
        id: list.id,
        title: list.title,
        position: list.position,
        card_limit: list.cardLimit,
        is_done: list.isDone,
        cards,
    };
}

/* -------------------------------------------------------------------------- */
/* Quadro                                                                      */
/* -------------------------------------------------------------------------- */

export type BoardSource = Pick<
    BoardRow,
    'id' | 'title' | 'description' | 'background' | 'ownerId' | 'autoArchiveDoneAfterDays'
>;

export interface BoardResourceData {
    /** Papel de quem está vendo — null se não for membro. */
    role: BoardRole | null;
    /** Favorito é por pessoa: vem da linha de board_user de quem está vendo. */
    isFavorite: boolean;
    /** As permissões que a tela precisa saber (`boardCan` da policy). */
    can: { manage: boolean; delete: boolean };
    /**
     * Quantos cards estão na gaveta. É ele que decide se o menu do quadro
     * mostra "Arquivados" — sem a contagem, o item apareceria sempre vazio,
     * em silêncio.
     */
    archivedCount: number;
    members: User[];
    /** Convites pendentes — vazio para quem não administra o quadro. */
    invitations: BoardInvitation[];
    labels: Label[];
    lists: BoardList[];
}

export function boardResource(board: BoardSource, data: BoardResourceData): Board {
    return {
        id: board.id,
        title: board.title,
        description: board.description,
        background: board.background as BoardBackground,
        owner_id: board.ownerId,
        is_favorite: data.isFavorite,
        role: data.role,

        // Dias até um concluído sair da coluna; null = desligado.
        auto_archive_days: board.autoArchiveDoneAfterDays,
        archived_count: data.archivedCount,
        can: { manage: data.can.manage, delete: data.can.delete },
        members: data.members,
        invitations: data.invitations,
        labels: data.labels,
        lists: data.lists,
    };
}

/* -------------------------------------------------------------------------- */
/* Resumo (a lista de quadros)                                                 */
/* -------------------------------------------------------------------------- */

export type BoardSummarySource = Pick<BoardRow, 'id' | 'title' | 'description' | 'background'> & {
    /** Colunas de board_user da própria pessoa. */
    role: BoardRole | string;
    isFavorite: boolean;
    lastOpenedAt: Date | null;
    listsCount: number;
    cardsCount: number;
    doneCount: number;
};

export function boardSummaryResource(board: BoardSummarySource, members: User[]): BoardSummary {
    return {
        id: board.id,
        title: board.title,
        description: board.description,
        background: board.background as BoardBackground,
        is_favorite: board.isFavorite,
        role: board.role as BoardRole,
        last_opened_at: toAppIso(board.lastOpenedAt),
        lists_count: board.listsCount,
        cards_count: board.cardsCount,
        done_count: board.doneCount,
        members,
    };
}
