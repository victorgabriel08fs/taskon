'use server';

import { redirect } from 'next/navigation';
import { pluralize } from '@/lib/utils';
import { defineAction, ok, toast } from '@/server/action';
import type { ArchiveActions } from '@/server/actions/contract';
import { flash } from '@/server/flash';
import { loadArchivedCards as archivedDrawer } from '@/server/queries/card';
import { archiveCard as archive, restoreCard as restore } from '@/server/services/cards';
import { archiveDoneNow } from '@/server/services/done-card-archiver';
import { id, z } from '@/server/validation';

/**
 * Arquivamento — arquivar e restaurar cards (antigo `CardController`), o
 * "Arquivar agora" (antigo `BoardController@archiveDone`) e a leitura da
 * gaveta (a antiga prop `optional` `archivedCards`).
 *
 * Restaurar e "Arquivar agora" mexem no quadro E na gaveta: o quadro volta
 * pelo `refresh()` do `defineAction`, e a gaveta atualizada vem como dado da
 * própria action — senão o card reapareceria na coluna e continuaria listado
 * na gaveta como arquivado.
 */

/** Sem confirmação na tela, de propósito: arquivar se desfaz em um clique. */
export const archiveCard = defineAction(
    z.object({ cardId: id() }),
    async ({ cardId }, { user }) => {
        const card = await archive(user, cardId);

        // O caminho de volta vai junto com o aviso: o card acabou de sumir da
        // tela, e "foi arquivado" sozinho não diz para onde ele foi.
        await flash(toast('success', `"${card.title}" foi para Arquivados, no menu do quadro.`));

        // Redirect explícito, não "voltar": a URL anterior pode ser a do
        // próprio card, e voltar para lá reabriria o modal de um card que não
        // está mais no quadro.
        redirect(`/boards/${card.boardId}`);
    },
) satisfies ArchiveActions['archiveCard'];

/** Reabre, devolve à primeira coluna comum e diz para onde o card foi. */
export const restoreCard = defineAction(
    z.object({ cardId: id() }),
    async ({ cardId }, { user }) => {
        const card = await restore(user, cardId);

        return ok(
            await archivedDrawer(user, card.boardId),
            toast('success', `"${card.title}" voltou para ${card.listTitle}.`),
        );
    },
) satisfies ArchiveActions['restoreCard'];

/** Roda agora a mesma varredura que o agendador roda de madrugada. */
export const archiveDoneCards = defineAction(
    z.object({ boardId: id() }),
    async ({ boardId }, { user }) => {
        const archived = await archiveDoneNow(user, boardId);
        const drawer = await archivedDrawer(user, boardId);

        if (archived === null) {
            return ok(drawer, toast('info', 'Escolha um prazo antes de arquivar os concluídos.'));
        }

        return ok(
            drawer,
            archived === 0
                ? toast('info', 'Nenhum concluído passou do prazo ainda.')
                : toast('success', `${pluralize(archived, 'card arquivado', 'cards arquivados')}.`),
        );
    },
) satisfies ArchiveActions['archiveDoneCards'];

/**
 * A gaveta, lida a cada abertura (é rara, e não pode custar uma consulta em
 * toda visita ao quadro). Só leitura: não re-renderiza a página.
 */
export const loadArchivedCards = defineAction(
    z.object({ boardId: id() }),
    async ({ boardId }, { user }) => archivedDrawer(user, boardId),
    { refresh: false },
) satisfies ArchiveActions['loadArchivedCards'];
