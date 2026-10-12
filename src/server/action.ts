import 'server-only';

import { refresh } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import type { z } from 'zod';
import type { ActionResult, Toast } from '@/types';
import { currentSession } from '@/server/auth/session';
import type { SessionRow, UserRow } from '@/server/db/schema';
import { HttpError, defaultMessage } from '@/server/errors';
import { fieldErrors } from '@/server/validation';

/**
 * A casca de toda Server Action — o que no Laravel era middleware + Form
 * Request + handler de exceção:
 *
 *   autentica → valida (zod) → executa → `refresh()` → ActionResult
 *
 * `refresh()` faz a página atual ser re-renderizada no servidor e voltar na
 * MESMA resposta da action. É o `return back()` do Inertia com as props novas:
 * o cliente não precisa buscar nada depois de mutar.
 *
 * `HttpError` (abort, ValidationError…) vira `{ ok: false, status, errors,
 * toast }`. Erro inesperado vira 500 com mensagem genérica — o detalhe fica no
 * log do servidor, nunca no navegador.
 */

export interface ActionContext {
    user: UserRow;
    session: SessionRow;
}

interface Options {
    /**
     * `'user'` (padrão) exige sessão; `'guest'` não exige (login, cadastro);
     * `'any'` deixa o handler decidir.
     */
    auth?: 'user' | 'guest' | 'any';

    /** Re-renderiza a página atual depois do sucesso. Padrão: true. */
    refresh?: boolean;
}

type Handler<Input, Output, Ctx> = (input: Input, ctx: Ctx) => Promise<Output | ActionResult<Output>>;

export function ok<T>(data: T, toast?: Toast): ActionResult<T> {
    return toast ? { ok: true, data, toast } : { ok: true, data };
}

export function toast(type: Toast['type'], message: string): Toast {
    return { type, message };
}

function isResult(value: unknown): value is ActionResult<unknown> {
    return typeof value === 'object' && value !== null && 'ok' in value && typeof (value as { ok: unknown }).ok === 'boolean';
}

function failure(error: HttpError): ActionResult<never> {
    return {
        ok: false,
        status: error.status,
        ...(error.errors ? { errors: error.errors } : {}),
        // Erro de validação aparece no campo; os outros viram toast.
        ...(error.status === 422 && error.errors ? {} : { toast: { type: 'error' as const, message: error.message } }),
    };
}

export function defineAction<Schema extends z.ZodType, Output>(
    schema: Schema,
    handler: Handler<z.output<Schema>, Output, ActionContext>,
    options?: Options & { auth?: 'user' },
): (input: z.input<Schema>) => Promise<ActionResult<Output>>;

export function defineAction<Schema extends z.ZodType, Output>(
    schema: Schema,
    handler: Handler<z.output<Schema>, Output, ActionContext | null>,
    options: Options & { auth: 'guest' | 'any' },
): (input: z.input<Schema>) => Promise<ActionResult<Output>>;

export function defineAction<Schema extends z.ZodType, Output>(
    schema: Schema,
    handler: Handler<z.output<Schema>, Output, never>,
    options: Options = {},
): (input: z.input<Schema>) => Promise<ActionResult<Output>> {
    const auth = options.auth ?? 'user';
    const shouldRefresh = options.refresh ?? true;

    return async (input) => {
        try {
            const current = await currentSession();

            if (auth === 'user' && !current) {
                return { ok: false, status: 401, toast: { type: 'error', message: defaultMessage(401) } };
            }

            const parsed = await schema.safeParseAsync(input);

            if (!parsed.success) {
                return { ok: false, status: 422, errors: fieldErrors(parsed.error) };
            }

            const ctx = current ? { user: current.user, session: current.session } : null;
            const output = await (handler as Handler<z.output<Schema>, Output, ActionContext | null>)(parsed.data, ctx);
            const result = isResult(output) ? (output as ActionResult<Output>) : ok(output as Output);

            if (result.ok && shouldRefresh) refresh();

            return result;
        } catch (error) {
            // redirect(), notFound() e companhia são controle de fluxo do Next.
            unstable_rethrow(error);

            if (error instanceof HttpError) {
                // O alvo sumiu (outra aba, outro membro): a tela atualizada
                // mostra o porquê melhor que o toast sozinho.
                if (error.status === 404 && shouldRefresh) refresh();

                return failure(error);
            }

            console.error('[action] erro inesperado', error);

            return { ok: false, status: 500, toast: { type: 'error', message: defaultMessage(500) } };
        }
    };
}
