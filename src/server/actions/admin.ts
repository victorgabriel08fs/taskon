'use server';

import { refresh } from 'next/cache';
import { defineAction, ok, toast } from '@/server/action';
import type { AdminActions } from '@/server/actions/contract';
import { HttpError } from '@/server/errors';
import * as adminService from '@/server/services/admin';
import { id, z } from '@/server/validation';

/**
 * O painel de administração (/admin). Finas como as outras: validam o id,
 * chamam o serviço e escolhem o aviso. Quem pode o quê — e o porquê da recusa,
 * que volta como toast — mora em src/server/services/admin.ts: toda action é
 * um endpoint público, e esconder o botão na tela não protege nada.
 */

/** Só o admin nativo. */
export const grantAdmin = defineAction(
    z.object({ userId: id() }),
    async ({ userId }, { user }) => {
        const { name } = await refreshOnRefusal(adminService.grantAdmin(user, userId));

        return ok(null, toast('success', `Agora ${name} é admin do Taskon.`));
    },
) satisfies AdminActions['grantAdmin'];

/** Só o admin nativo. */
export const revokeAdmin = defineAction(
    z.object({ userId: id() }),
    async ({ userId }, { user }) => {
        const { name } = await refreshOnRefusal(adminService.revokeAdmin(user, userId));

        return ok(null, toast('success', `${name} não é mais admin.`));
    },
) satisfies AdminActions['revokeAdmin'];

/** Derruba todas as sessões da conta na hora. */
export const blockUser = defineAction(
    z.object({ userId: id() }),
    async ({ userId }, { user }) => {
        const { name } = await refreshOnRefusal(adminService.blockUser(user, userId));

        return ok(null, toast('success', `${name} foi bloqueado(a) — as sessões abertas caíram.`));
    },
) satisfies AdminActions['blockUser'];

/** A pessoa volta a entrar — as sessões derrubadas no bloqueio não voltam. */
export const unblockUser = defineAction(
    z.object({ userId: id() }),
    async ({ userId }, { user }) => {
        const { name } = await refreshOnRefusal(adminService.unblockUser(user, userId));

        return ok(null, toast('success', `${name} foi desbloqueado(a).`));
    },
) satisfies AdminActions['unblockUser'];

/**
 * Recusa aqui quer dizer, quase sempre, que a tela estava velha: outra aba,
 * outro admin ou o nativo mudou a conta ("já está bloqueado(a)", 422) ou o
 * poder de quem clicou (403) depois que a página foi desenhada. Então a página
 * volta atualizada junto com o toast, como no sucesso — sem isso o botão velho
 * continuaria na linha, falhando a cada clique até um F5; e quem perdeu o
 * admin continuaria vendo o painel, que agora é 404 para ele.
 *
 * Só nestas actions: no resto do app um 403/422 não quer dizer tela velha (o
 * 422 de formulário, por exemplo). O 404 o `defineAction` já re-renderiza, e o
 * 422 do zod sai antes de chegar aqui.
 */
async function refreshOnRefusal<T>(operation: Promise<T>): Promise<T> {
    try {
        return await operation;
    } catch (error) {
        if (error instanceof HttpError && (error.status === 403 || error.status === 422)) refresh();

        throw error;
    }
}
