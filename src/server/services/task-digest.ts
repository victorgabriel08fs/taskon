import 'server-only';

import { and, asc, count, desc, eq, gte, isNotNull, isNull, lte } from 'drizzle-orm';
import { addAppDays, endOfAppDay, startOfAppDay } from '@/lib/timezone';
import { config } from '@/server/config';
import { db } from '@/server/db';
import { boardLists, boards, cards, type UserRow } from '@/server/db/schema';
import { assignedTo } from '@/server/queries/scopes';

/**
 * O antigo `App\Support\TaskDigest`: o retrato das tarefas de uma pessoa num
 * instante — a matéria-prima do resumo diário, da prévia em Configurações ›
 * Notificações e do painel.
 *
 * Só entram cards ATRIBUÍDOS ao usuário (ver `assignedTo`). Três consultas por
 * pessoa: os cards com prazo no horizonte, os concluídos nas últimas 24 h e a
 * contagem de abertos.
 *
 * A fronteira entre "vencida" e "vence hoje" é a VIRADA DO DIA no fuso do app,
 * não a hora marcada. Um card para hoje às 10:00 continua "de hoje" às 11:00 —
 * chamá-lo de vencido às 10:01 pintaria o painel inteiro de vermelho no meio da
 * manhã e esvaziaria o sinal de quem está de fato atrasado há dias.
 */

/** Um card visto de fora do quadro, com o quadro e a lista para dar contexto. */
export interface DigestCard {
    id: number;
    title: string;
    dueAt: Date | null;
    completedAt: Date | null;
    boardId: number;
    boardTitle: string;
    boardBackground: string;
    listTitle: string;
}

export interface TaskDigest {
    user: Pick<UserRow, 'id' | 'name' | 'email'>;
    now: Date;
    /** Prazo já passou (antes da meia-noite de hoje). */
    overdue: DigestCard[];
    /** Vence hoje — ainda dá tempo. */
    today: DigestCard[];
    /** Vence depois de hoje, dentro do horizonte. */
    upcoming: DigestCard[];
    /** Concluídos nas últimas 24 h. */
    completed: DigestCard[];
    openCount: number;
}

export interface DigestSection {
    key: 'overdue' | 'today' | 'upcoming';
    title: string;
    tone: 'danger' | 'warning' | 'neutral';
    /** Total real da seção — o corte de `cards` é só de exibição ("3 de 12"). */
    total: number;
    cards: DigestCard[];
}

const digestColumns = {
    id: cards.id,
    title: cards.title,
    dueAt: cards.dueAt,
    completedAt: cards.completedAt,
    boardId: boards.id,
    boardTitle: boards.title,
    boardBackground: boards.background,
    listTitle: boardLists.title,
};

/** Fronteiras do dia no fuso do app — as mesmas do painel e do e-mail. */
export function dayBoundaries(now: Date) {
    return {
        startOfToday: startOfAppDay(now),
        endOfToday: endOfAppDay(now),
        horizon: endOfAppDay(addAppDays(now, config.digest.horizonDays)),
    };
}

export async function taskDigestFor(user: Pick<UserRow, 'id' | 'name' | 'email'>, now: Date = new Date()): Promise<TaskDigest> {
    const { startOfToday, endOfToday, horizon } = dayBoundaries(now);

    const due = await db
        .select(digestColumns)
        .from(cards)
        .innerJoin(boards, eq(boards.id, cards.boardId))
        .innerJoin(boardLists, eq(boardLists.id, cards.boardListId))
        .where(and(assignedTo(user.id), isNull(cards.completedAt), isNotNull(cards.dueAt), lte(cards.dueAt, horizon)))
        .orderBy(asc(cards.dueAt), asc(cards.id));

    const completed = await db
        .select(digestColumns)
        .from(cards)
        .innerJoin(boards, eq(boards.id, cards.boardId))
        .innerJoin(boardLists, eq(boardLists.id, cards.boardListId))
        .where(and(assignedTo(user.id), isNotNull(cards.completedAt), gte(cards.completedAt, addAppDays(now, -1))))
        .orderBy(desc(cards.completedAt), desc(cards.id));

    const [open] = await db
        .select({ total: count() })
        .from(cards)
        .where(and(assignedTo(user.id), isNull(cards.completedAt)));

    return {
        user,
        now,
        overdue: due.filter((card) => card.dueAt! < startOfToday),
        today: due.filter((card) => card.dueAt! >= startOfToday && card.dueAt! <= endOfToday),
        upcoming: due.filter((card) => card.dueAt! > endOfToday),
        completed,
        openCount: open?.total ?? 0,
    };
}

/** Nada vencido, nada no horizonte, nada concluído: não há resumo a mandar. */
export function isDigestEmpty(digest: TaskDigest): boolean {
    return (
        digest.overdue.length === 0 &&
        digest.today.length === 0 &&
        digest.upcoming.length === 0 &&
        digest.completed.length === 0
    );
}

/** As seções na ordem do e-mail, sem as vazias, já cortadas no teto. */
export function digestSections(digest: TaskDigest): DigestSection[] {
    const max = config.digest.maxPerSection;

    const sections: Omit<DigestSection, 'total'>[] = [
        { key: 'overdue', title: 'Vencidas', tone: 'danger', cards: digest.overdue },
        { key: 'today', title: 'Vencem hoje', tone: 'warning', cards: digest.today },
        { key: 'upcoming', title: 'Próximos dias', tone: 'neutral', cards: digest.upcoming },
    ];

    return sections
        .filter((section) => section.cards.length > 0)
        .map((section) => ({ ...section, total: section.cards.length, cards: section.cards.slice(0, max) }));
}
