import 'server-only';

import { and, asc, count, eq, isNotNull, isNull, lte, type SQL } from 'drizzle-orm';
import { addAppDays } from '@/lib/timezone';
import { pluralize } from '@/lib/utils';
import { db } from '@/server/db';
import { boards, cards, type BoardRow, type UserRow } from '@/server/db/schema';
import { authorizeBoard } from '@/server/policies/board';
import { logActivity } from '@/server/services/activity';

/**
 * O antigo `DoneCardArchiver`: a varredura que tira do quadro o que já foi
 * concluído há tempo demais.
 *
 * A coluna "Concluído" é um cemitério que cresce: em algumas semanas ela tem
 * mais cards que todas as outras somadas, e o que interessa — o que falta —
 * fica espremido. Este é o serviço que a esvazia sozinha.
 *
 * Arquivar NÃO apaga. O card continua no banco com `archived_at` preenchido:
 * some das colunas, continua contando no progresso do quadro (ver `counted()`
 * em src/server/queries/scopes.ts) e volta pela tela de arquivados.
 *
 * Três portas chamam daqui — o Cron da Vercel (/api/cron/archive-done-cards),
 * o script `npm run archive-done` e o botão "Arquivar agora" — justamente para
 * as três não divergirem sobre o que "passou do prazo" quer dizer.
 */

type SweepableBoard = Pick<BoardRow, 'id' | 'autoArchiveDoneAfterDays'>;

/**
 * Cards do quadro que já passaram do prazo.
 *
 * `completed_at` e não `updated_at`: o relógio começa a correr quando a
 * tarefa terminou, não na última vez que alguém encostou no card. Reordenar
 * uma coluna toca o `updated_at` de todo mundo que está nela, e o prazo
 * nunca venceria num quadro em uso.
 *
 * O prazo é em dias de CALENDÁRIO no fuso do app (o `subDays` do Carbon).
 */
function overdue(board: SweepableBoard, days: number, now: Date): SQL {
    return and(
        eq(cards.boardId, board.id),
        isNull(cards.archivedAt),
        isNotNull(cards.completedAt),
        lte(cards.completedAt, addAppDays(now, -days)),
    )!;
}

/** Quantos cards a próxima varredura levaria — sem levar nenhum. */
export async function pendingCount(board: SweepableBoard, now: Date = new Date()): Promise<number> {
    const days = board.autoArchiveDoneAfterDays;

    if (days === null) return 0;

    const [row] = await db.select({ total: count() }).from(cards).where(overdue(board, days, now));

    return row?.total ?? 0;
}

/**
 * Arquiva e devolve quantos saíram.
 *
 * O histórico ganha UMA linha por varredura, não uma por card: vinte
 * "arquivou tal card" seguidos afogariam o feed do quadro no dia em que a
 * pessoa ligar o recurso pela primeira vez.
 *
 * `actorId` é quem apertou "Arquivar agora"; na varredura agendada ninguém
 * clicou, e a linha do histórico fica sem autor (null).
 */
export async function sweep(board: SweepableBoard, now: Date = new Date(), actorId: number | null = null): Promise<number> {
    const days = board.autoArchiveDoneAfterDays;

    if (days === null) return 0;

    return db.transaction(async (tx) => {
        const archived = (
            await tx.update(cards).set({ archivedAt: now }).where(overdue(board, days, now)).returning({ id: cards.id })
        ).length;

        if (archived > 0) {
            await logActivity(
                {
                    boardId: board.id,
                    userId: actorId,
                    type: 'cards.auto_archived',
                    description:
                        `arquivou ${pluralize(archived, 'card concluído', 'cards concluídos')}` +
                        ` há mais de ${pluralize(days, 'dia', 'dias')}`,
                    properties: { count: archived, after_days: days },
                },
                tx,
            );
        }

        return archived;
    });
}

/**
 * O botão "Arquivar agora": roda a varredura deste quadro sem esperar a
 * madrugada (só owner/admin — é configuração do quadro).
 *
 * Existe porque o recurso é invisível até a primeira vez que acontece:
 * quem acabou de escolher "7 dias" não tem como saber o que vai sumir nem
 * conferir se acertou. O botão transforma uma promessa em resultado — e usa
 * exatamente o mesmo filtro do agendador, senão a prévia mentiria.
 *
 * Devolve quantos saíram, ou `null` quando o quadro não tem prazo: aí não há
 * o que varrer, e a tela pede para escolher um.
 */
export async function archiveDoneNow(actor: Pick<UserRow, 'id'>, boardId: number, now: Date = new Date()): Promise<number | null> {
    const { board } = await authorizeBoard(actor, boardId, 'manage');

    if (board.autoArchiveDoneAfterDays === null) return null;

    return sweep(board, now, actor.id);
}

/* -------------------------------------------------------------------------- */
/* A varredura noturna (cron e script)                                         */
/* -------------------------------------------------------------------------- */

export interface SweepBoardResult {
    id: number;
    title: string;
    /** O prazo do quadro, em dias. */
    days: number;
    /** Quantos saíram (ou, no dry-run, quantos sairiam). */
    count: number;
}

export interface SweepReport {
    dryRun: boolean;
    boards: SweepBoardResult[];
    total: number;
}

export interface SweepOptions {
    now?: Date;
    /** Mostra o que sairia do quadro, sem arquivar nada. */
    dryRun?: boolean;
    /** Varre só este quadro. */
    boardId?: number | null;
}

/**
 * A varredura de todos os quadros vivos com prazo — o antigo
 * `php artisan taskon:archive-done-cards`. Quadro sem prazo definido não é
 * tocado, e esse é o padrão de todos eles.
 */
export async function sweepBoards(options: SweepOptions = {}): Promise<SweepReport> {
    const now = options.now ?? new Date();
    const dryRun = options.dryRun ?? false;
    const only = options.boardId ?? null;

    const candidates = await db
        .select({ id: boards.id, title: boards.title, autoArchiveDoneAfterDays: boards.autoArchiveDoneAfterDays })
        .from(boards)
        .where(
            and(
                isNull(boards.archivedAt),
                isNotNull(boards.autoArchiveDoneAfterDays),
                only !== null ? eq(boards.id, only) : undefined,
            ),
        )
        .orderBy(asc(boards.id));

    const results: SweepBoardResult[] = [];
    let total = 0;

    for (const board of candidates) {
        // No dry-run a contagem usa exatamente o mesmo filtro do sweep —
        // é a única forma de a simulação valer alguma coisa.
        const archived = dryRun ? await pendingCount(board, now) : await sweep(board, now, null);

        total += archived;
        results.push({ id: board.id, title: board.title, days: board.autoArchiveDoneAfterDays ?? 0, count: archived });
    }

    return { dryRun, boards: results, total };
}

/** O resumo legível da varredura, linha a linha — o que o comando artisan imprimia. */
export function describeSweep(report: SweepReport): string[] {
    if (report.boards.length === 0) return ['Nenhum quadro com arquivamento automático ligado.'];

    const lines = [
        (report.dryRun ? 'Simulando a varredura de ' : 'Varrendo ') +
            pluralize(report.boards.length, 'quadro', 'quadros'),
    ];

    for (const board of report.boards) {
        const prazo = pluralize(board.days, 'dia', 'dias');

        if (board.count === 0) {
            lines.push(`  – ${board.title} · nada além de ${prazo}`);

            continue;
        }

        const marca = report.dryRun ? '?' : '✓';

        lines.push(`  ${marca} ${board.title} · ${pluralize(board.count, 'card', 'cards')} · prazo de ${prazo}`);
    }

    lines.push(`${report.dryRun ? 'Sairiam' : 'Arquivados'}: ${report.total}`);

    return lines;
}
