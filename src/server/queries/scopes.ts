import 'server-only';

import { and, eq, exists, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import { db } from '@/server/db';
import { boardUser, boards, cardUser, cards } from '@/server/db/schema';

/**
 * Os scopes do model Card do Laravel, como fragmentos SQL reaproveitáveis.
 * Use-os em `.where(...)` de consultas cujo FROM é `cards` (sem alias): as
 * subconsultas são correlacionadas por `"cards"."id"` / `"cards"."board_id"`.
 */

/**
 * `Card::scopeCounted` — o recorte de PROGRESSO: o que ainda está no quadro,
 * mais o que saiu de lá já concluído.
 *
 * Arquivar um concluído não pode apagar a conquista: sem isto, ligar o
 * arquivamento automático faria a barra do quadro voltar de 100% para 0%
 * justamente por o trabalho ter terminado. Já o card arquivado SEM concluir
 * foi abandonado de propósito — sai dos dois lados da conta.
 */
export function counted(): SQL {
    return or(isNull(cards.archivedAt), isNotNull(cards.completedAt))!;
}

/**
 * `Card::scopeAssignedTo` — cards atribuídos ao usuário, em quadros vivos de
 * que ele ainda participa.
 *
 * O segundo filtro não é redundante: sair de um quadro não apaga a atribuição
 * dos cards, e sem ele a pessoa continuaria vendo (e recebendo por e-mail)
 * tarefas de um quadro que já não pode nem abrir.
 *
 * É a definição de "minhas tarefas" que o resumo diário e o painel
 * compartilham — se as duas divergirem, o e-mail vira mentira sobre a tela.
 *
 * `history` troca o recorte de "o que ainda está no quadro" por `counted()`:
 * conta o que foi FEITO (concluídas na semana), não o que FALTA.
 */
export function assignedTo(userId: number, history = false): SQL {
    return and(
        history ? counted() : isNull(cards.archivedAt),
        exists(
            db
                .select({ one: sql`1` })
                .from(cardUser)
                .where(and(eq(cardUser.cardId, cards.id), eq(cardUser.userId, userId))),
        ),
        exists(
            db
                .select({ one: sql`1` })
                .from(boards)
                .where(
                    and(
                        eq(boards.id, cards.boardId),
                        isNull(boards.archivedAt),
                        exists(
                            db
                                .select({ one: sql`1` })
                                .from(boardUser)
                                .where(and(eq(boardUser.boardId, boards.id), eq(boardUser.userId, userId))),
                        ),
                    ),
                ),
        ),
    )!;
}
