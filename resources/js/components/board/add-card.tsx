import { router } from '@inertiajs/react';
import { Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Composer inline: Enter salva e mantém o campo aberto para o próximo card,
 * Esc fecha. É o fluxo que faz alguém escrever dez cards em vinte segundos.
 */
export function AddCard({ listId, className }: { listId: number; className?: string }) {
    const [open, setOpen] = useState(false);
    const [title, setTitle] = useState('');
    const [saving, setSaving] = useState(false);
    const textarea = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (open) textarea.current?.focus();
    }, [open]);

    const submit = () => {
        const value = title.trim();

        if (!value) return;

        setSaving(true);

        router.post(
            `/lists/${listId}/cards`,
            { title: value },
            {
                preserveScroll: true,
                preserveState: true,
                only: ['board'],
                onSuccess: () => {
                    setTitle('');
                    requestAnimationFrame(() => textarea.current?.focus());
                },
                onFinish: () => setSaving(false),
            },
        );
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
                placeholder="Título do card…"
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        submit();
                    }

                    if (event.key === 'Escape') {
                        setOpen(false);
                        setTitle('');
                    }
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
                    onClick={() => {
                        setOpen(false);
                        setTitle('');
                    }}
                    className="rounded-md p-1.5 text-muted-fg transition-colors hover:bg-surface-3 hover:text-foreground"
                >
                    <X className="size-4" />
                </button>
                <span className="text-[11px] text-muted-fg">Enter salva · Esc fecha</span>
            </div>
        </div>
    );
}
