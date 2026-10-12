import 'server-only';

import type { BoardBackground, BoardProgress, Deadline } from '@/types';
import { toAppIso } from '@/lib/timezone';
import type { DigestCard } from '@/server/services/task-digest';

/**
 * DeadlineResource — um card visto de fora do quadro: no painel ele precisa
 * dizer de onde veio, porque a lista mistura quadros diferentes.
 */
export function deadlineResource(card: DigestCard): Deadline {
    return {
        id: card.id,
        title: card.title,
        due_at: toAppIso(card.dueAt),
        completed_at: toAppIso(card.completedAt),
        board_id: card.boardId,
        board_title: card.boardTitle,
        board_background: card.boardBackground as BoardBackground,
        list_title: card.listTitle,
    };
}

/** Um quadro com as três contagens agregadas no banco (ver `loadDashboard`). */
export interface BoardProgressRow {
    id: number;
    title: string;
    background: string;
    total: number | null;
    done: number | null;
    overdue: number | null;
}

/**
 * BoardProgressResource — o quadro reduzido a três números. Espera as
 * contagens agregadas da consulta do painel; sem elas tudo vira zero, em
 * silêncio.
 */
export function boardProgressResource(board: BoardProgressRow): BoardProgress {
    return {
        id: board.id,
        title: board.title,
        background: board.background as BoardBackground,
        total: Number(board.total ?? 0),
        done: Number(board.done ?? 0),
        overdue: Number(board.overdue ?? 0),
    };
}
