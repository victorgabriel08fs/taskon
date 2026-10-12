'use client';

import { Plus, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { runAction } from '@/lib/actions';
import { cn } from '@/lib/utils';
import { createCard } from '@/server/actions/cards';
import type { ActionResult } from '@/types';

export interface Composer {
    title: string;
    setTitle: (value: string) => void;
    /** Envia o que está no campo; false quando não havia nada para enviar. */
    submit: () => boolean;
    /** Algum envio ainda sem resposta. */
    saving: boolean;
}

/**
 * O envio dos compositores inline (card e lista). Cada envio leva o PRÓPRIO
 * título e libera o campo na hora, como o `router.post` do Inertia, que não
 * bloqueava: dá para escrever o próximo enquanto o anterior ainda está a
 * caminho — e o Next despacha as actions em fila, na ordem. Nada é descartado
 * por "ainda estar salvando": antes, o segundo Enter era ignorado e, quando o
 * primeiro voltava, o texto do segundo era apagado.
 *
 * Se um envio falhar, o texto volta ao campo — a menos que a pessoa já esteja
 * escrevendo outro — e o aviso do erro sai pelo `runAction`, como sempre.
 */
export function useComposer(create: (title: string) => Promise<ActionResult<unknown>>): Composer {
    const [title, setTitleState] = useState('');
    const [pending, setPending] = useState(0);

    // Espelho síncrono do campo. O envio lê daqui, e não do `title` da
    // closure: dois envios no mesmo tick (antes de o React re-renderizar)
    // veriam o mesmo texto e criariam o item duas vezes. E a devolução, que
    // roda quando a resposta chega, precisa do campo de AGORA.
    const draft = useRef('');

    const setTitle = useCallback((value: string) => {
        draft.current = value;
        setTitleState(value);
    }, []);

    const submit = () => {
        const value = draft.current.trim();

        if (!value) return false;

        setTitle('');
        setPending((count) => count + 1);

        void runAction(() => create(value), {
            onFinish: () => setPending((count) => count - 1),
        }).then((result) => {
            if (!result?.ok && !draft.current.trim()) setTitle(value);
        });

        return true;
    };

    return { title, setTitle, submit, saving: pending > 0 };
}

/**
 * Composer inline: Enter salva e mantém o campo aberto para o próximo card,
 * Esc fecha. É o fluxo que faz alguém escrever dez cards em vinte segundos.
 */
export function AddCard({ listId, className }: { listId: number; className?: string }) {
    const [open, setOpen] = useState(false);
    const { title, setTitle, submit: send, saving } = useComposer((value) => createCard({ listId, title: value }));
    const textarea = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (open) textarea.current?.focus();
    }, [open]);

    const submit = () => {
        // O campo já está livre para o próximo: o foco volta para ele (quem
        // clicou em "Adicionar" o tinha levado para o botão).
        if (send()) requestAnimationFrame(() => textarea.current?.focus());
    };

    const close = () => {
        setOpen(false);
        setTitle('');
    };

    if (!open) {
        return (
            <button
                type="button"
                onClick={() => setOpen(true)}
                className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-muted-fg',
                    'transition-colors duration-150 hover:bg-surface-3 hover:text-foreground',
                    className,
                )}
            >
                <Plus className="size-4" />
                Adicionar card
            </button>
        );
    }

    return (
        <div className={cn('animate-pop space-y-2', className)}>
            <textarea
                ref={textarea}
                rows={2}
                value={title}
                maxLength={500}
                aria-label="Título do novo card"
                placeholder="Título do card…"
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        submit();
                    }

                    if (event.key === 'Escape') close();
                }}
                onBlur={() => {
                    if (!title.trim()) setOpen(false);
                }}
                className="w-full resize-none rounded-lg bg-surface px-2.5 py-2 text-sm shadow-sm ring-1 ring-border placeholder:text-muted-fg/70 focus:outline-none focus:ring-2 focus:ring-primary"
            />

            <div className="flex items-center gap-2">
                <Button size="sm" onClick={submit} loading={saving}>
                    Adicionar
                </Button>
                <button
                    type="button"
                    aria-label="Cancelar"
                    onClick={close}
                    className="rounded-md p-1.5 text-muted-fg transition-colors hover:bg-surface-3 hover:text-foreground"
                >
                    <X className="size-4" />
                </button>
                <span className="text-[11px] text-muted-fg">Enter salva · Esc fecha</span>
            </div>
        </div>
    );
}
