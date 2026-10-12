'use server';

import { defineAction } from '@/server/action';
import type { ExportActions } from '@/server/actions/contract';
import { loadExportDetails as exportDetails } from '@/server/queries/card';
import { id, z } from '@/server/validation';

/**
 * Exportação — a antiga prop `optional` `exportDetails` do quadro.
 *
 * Descrição, checklist e comentário de TODOS os cards só são lidos quando
 * alguém abre a exportação; o modal pede uma vez e guarda. Só leitura: não
 * re-renderiza a página.
 */
export const loadExportDetails = defineAction(
    z.object({ boardId: id() }),
    async ({ boardId }, { user }) => exportDetails(user, boardId),
    { refresh: false },
) satisfies ExportActions['loadExportDetails'];
