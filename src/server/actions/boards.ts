'use server';

import { redirect } from 'next/navigation';
import { defineAction, ok, toast } from '@/server/action';
import type { BoardActions } from '@/server/actions/contract';
import { BACKGROUNDS } from '@/server/config';
import { flash } from '@/server/flash';
import * as boardService from '@/server/services/boards';
import * as memberService from '@/server/services/members';
import { email, id, nullableString, oneOf, requiredString, z } from '@/server/validation';

/**
 * Quadros e membros — as rotas de /boards do antigo routes/web.php. Finas de
 * propósito: validam a forma, chamam o serviço e escolhem o aviso. A regra
 * (permissão, prazos aceitos, dono que não sai) mora em src/server/services.
 */

const DEADLINE_MESSAGE = 'Escolha um dos prazos oferecidos.';

/** Cria o quadro e leva a pessoa direto para ele. */
export const createBoard = defineAction(
    z.object({
        title: requiredString(120),
        background: oneOf(BACKGROUNDS),
    }),
    async (input, { user }) => {
        const board = await boardService.createBoard(user, input);

        await flash(toast('success', 'Quadro criado.'));

        redirect(`/boards/${board.id}`);
    },
) satisfies BoardActions['createBoard'];

/** Configurações do quadro (owner/admin). Só os campos enviados mudam. */
export const updateBoard = defineAction(
    z.object({
        boardId: id(),
        title: requiredString(120).optional(),
        description: nullableString(2000).optional(),
        background: oneOf(BACKGROUNDS).optional(),

        // `nullable` sem ser obrigatório: mandar null é o jeito de desligar.
        // Quais prazos valem é o serviço quem confere (config.autoArchive.options).
        auto_archive_done_after_days: z
            .number({ error: DEADLINE_MESSAGE })
            .int({ error: DEADLINE_MESSAGE })
            .nullable()
            .optional(),
    }),
    async ({ boardId, ...changes }, { user }) => {
        await boardService.updateBoard(user, boardId, changes);

        return null;
    },
) satisfies BoardActions['updateBoard'];

/** Só o dono. Volta para a lista de quadros. */
export const deleteBoard = defineAction(
    z.object({ boardId: id() }),
    async ({ boardId }, { user }) => {
        await boardService.deleteBoard(user, boardId);

        await flash(toast('success', 'Quadro excluído.'));

        redirect('/boards');
    },
) satisfies BoardActions['deleteBoard'];

/** Favorito é por pessoa. */
export const toggleFavorite = defineAction(
    z.object({ boardId: id() }),
    async ({ boardId }, { user }) => {
        await boardService.toggleFavorite(user, boardId);

        return null;
    },
) satisfies BoardActions['toggleFavorite'];

/** Convida uma conta existente pelo e-mail (owner/admin). Erros no campo `email`. */
export const addBoardMember = defineAction(
    z.object({
        boardId: id(),
        email: email(),
        role: oneOf(['admin', 'member']),
    }),
    async ({ boardId, ...input }, { user }) => {
        const result = await memberService.addBoardMember(user, boardId, input);

        // Quem já tem conta entra na hora; quem não tem recebe o convite por e-mail.
        return ok(
            null,
            result.kind === 'added'
                ? toast('success', `${result.member.name} entrou no quadro.`)
                : toast('success', `Convite enviado para ${result.email}.`),
        );
    },
) satisfies BoardActions['addBoardMember'];

/** Tira alguém do quadro (owner/admin). O dono não sai — o aviso vem em toast. */
export const removeBoardMember = defineAction(
    z.object({ boardId: id(), userId: id() }),
    async ({ boardId, userId }, { user }) => {
        await memberService.removeBoardMember(user, boardId, userId);

        return null;
    },
) satisfies BoardActions['removeBoardMember'];
