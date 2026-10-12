'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { ActionResult, FieldErrors, Toast } from '@/types';

/**
 * O lado do navegador das Server Actions — o que no Inertia eram o `router` e
 * o `useForm`. Toda chamada passa por `runAction`, que:
 *
 *  - mostra o toast que o servidor mandou (o antigo `Inertia::flash`);
 *  - transforma 403/404/500 sem mensagem em aviso legível;
 *  - manda para o login quando a sessão expirou (401);
 *  - trata queda de rede/deploy novo como "não salvou", nunca em silêncio.
 *
 * A página em si NÃO precisa ser recarregada aqui: a action chama `refresh()`
 * no servidor e a árvore nova volta na mesma resposta.
 */

const NETWORK_ERROR = 'Sem conexão com o servidor. Suas alterações locais não foram salvas.';

/**
 * Action que termina em `redirect()` não resolve a Promise: o Next a REJEITA
 * com o erro de controle NEXT_REDIRECT enquanto navega (server-action-reducer).
 * Não é falha — a tela já está trocando e o aviso viaja no cookie de flash.
 */
function isRedirect(error: unknown): boolean {
    const digest = typeof error === 'object' && error !== null ? (error as { digest?: unknown }).digest : undefined;

    return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT');
}

export function showToast(payload: Toast | undefined): void {
    if (!payload) return;

    const notify = payload.type === 'error' ? toast.error : payload.type === 'info' ? toast.info : toast.success;

    notify(payload.message);
}

export interface RunOptions<T> {
    onSuccess?: (data: T) => void;
    onError?: (result: Extract<ActionResult<T>, { ok: false }>) => void;
    onFinish?: () => void;
}

export async function runAction<T>(
    call: Promise<ActionResult<T>> | (() => Promise<ActionResult<T>>),
    options: RunOptions<T> = {},
): Promise<ActionResult<T> | null> {
    try {
        const result = await (typeof call === 'function' ? call() : call);

        showToast(result.toast);

        if (result.ok) {
            options.onSuccess?.(result.data);
        } else {
            if (result.status === 401) {
                const here = window.location.pathname + window.location.search;

                window.location.assign(`/login?next=${encodeURIComponent(here)}`);
            }

            options.onError?.(result);
        }

        return result;
    } catch (error) {
        if (isRedirect(error)) return null;

        // Deploy novo (action que não existe mais) ou rede fora: nada foi salvo.
        console.error(error);
        toast.error(NETWORK_ERROR);

        return null;
    } finally {
        // Se a action redirecionou, o aviso dela está num cookie de flash.
        window.dispatchEvent(new Event('taskon:flash'));
        options.onFinish?.();
    }
}

type Keys<T> = Extract<keyof T, string>;

export interface ActionForm<TData extends Record<string, unknown>, TResult> {
    data: TData;
    setData: {
        <K extends Keys<TData>>(key: K, value: TData[K]): void;
        (values: Partial<TData>): void;
    };
    errors: Partial<Record<Keys<TData> | 'form', string>> & FieldErrors;
    processing: boolean;
    /** Verdadeiro por 2 s depois de um envio bem-sucedido (o "Salvo!" dos formulários). */
    recentlySuccessful: boolean;
    submit: (options?: RunOptions<TResult>) => Promise<ActionResult<TResult> | null>;
    reset: (...fields: Keys<TData>[]) => void;
    clearErrors: (...fields: string[]) => void;
    setError: (field: string, message: string) => void;
}

/**
 * O `useForm` do Inertia, apontado para uma Server Action: guarda os campos,
 * envia, recebe os erros por campo (422) e expõe `processing`.
 */
export function useActionForm<TData extends Record<string, unknown>, TResult = null>(
    initial: TData,
    action: (data: TData) => Promise<ActionResult<TResult>>,
): ActionForm<TData, TResult> {
    const defaults = useRef(initial);
    const [data, setDataState] = useState<TData>(initial);
    const [errors, setErrors] = useState<FieldErrors>({});
    const [processing, setProcessing] = useState(false);
    const [recentlySuccessful, setRecentlySuccessful] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => () => {
        if (timer.current) clearTimeout(timer.current);
    }, []);

    const setData = useCallback((keyOrValues: string | Partial<TData>, value?: unknown) => {
        setDataState((current) =>
            typeof keyOrValues === 'string' ? { ...current, [keyOrValues]: value } : { ...current, ...keyOrValues },
        );
    }, []) as ActionForm<TData, TResult>['setData'];

    const reset = useCallback((...fields: Keys<TData>[]) => {
        setDataState((current) => {
            if (fields.length === 0) return defaults.current;

            const next = { ...current };

            fields.forEach((field) => {
                next[field] = defaults.current[field];
            });

            return next;
        });
    }, []);

    const clearErrors = useCallback((...fields: string[]) => {
        setErrors((current) => {
            if (fields.length === 0) return {};

            const next = { ...current };

            fields.forEach((field) => delete next[field]);

            return next;
        });
    }, []);

    const setError = useCallback((field: string, message: string) => {
        setErrors((current) => ({ ...current, [field]: message }));
    }, []);

    const submit = useCallback(
        async (options: RunOptions<TResult> = {}) => {
            setProcessing(true);

            return runAction(action(data), {
                onSuccess: (result) => {
                    setErrors({});
                    setRecentlySuccessful(true);

                    if (timer.current) clearTimeout(timer.current);
                    timer.current = setTimeout(() => setRecentlySuccessful(false), 2000);

                    options.onSuccess?.(result);
                },
                onError: (result) => {
                    setErrors(result.errors ?? {});
                    options.onError?.(result);
                },
                onFinish: () => {
                    setProcessing(false);
                    options.onFinish?.();
                },
            });
        },
        [action, data],
    );

    return {
        data,
        setData,
        errors: errors as ActionForm<TData, TResult>['errors'],
        processing,
        recentlySuccessful,
        submit,
        reset,
        clearErrors,
        setError,
    };
}
