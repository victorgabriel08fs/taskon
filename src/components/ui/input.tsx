'use client';

import {
    createContext,
    forwardRef,
    use,
    useId,
    type InputHTMLAttributes,
    type ReactNode,
    type TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/utils';

const base =
    'w-full rounded-lg bg-surface px-3.5 py-2.5 text-sm text-foreground ring-1 ring-border ' +
    'placeholder:text-muted-fg/70 transition-all duration-150 ' +
    'hover:ring-border focus:outline-none focus:ring-2 focus:ring-primary ' +
    'disabled:cursor-not-allowed disabled:opacity-60';

/**
 * O que o <Field> conta ao campo de dentro: o id que o <label> aponta e a
 * mensagem (dica ou erro) que descreve o campo. Sem isso o leitor de tela
 * anunciava "campo de edição" sem nome — a lacuna já existia no legado.
 */
const FieldContext = createContext<{ id: string; invalid: boolean; describedBy?: string } | null>(null);

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
    { className, ...props },
    ref,
) {
    const field = use(FieldContext);

    return (
        <input
            ref={ref}
            id={field?.id}
            aria-invalid={field?.invalid || undefined}
            aria-describedby={field?.describedBy}
            className={cn(base, className)}
            {...props}
        />
    );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
    function Textarea({ className, ...props }, ref) {
        const field = use(FieldContext);

        return (
            <textarea
                ref={ref}
                id={field?.id}
                aria-invalid={field?.invalid || undefined}
                aria-describedby={field?.describedBy}
                className={cn(base, 'resize-y leading-relaxed', className)}
                {...props}
            />
        );
    },
);

export function Field({
    label,
    error,
    hint,
    children,
    className,
}: {
    label?: string;
    error?: string;
    hint?: string;
    children: ReactNode;
    className?: string;
}) {
    const id = useId();
    const messageId = `${id}-message`;

    return (
        <FieldContext value={{ id, invalid: Boolean(error), describedBy: error || hint ? messageId : undefined }}>
            <div className={cn('space-y-1.5', className)}>
                {label && (
                    <label htmlFor={id} className="block text-sm font-medium text-foreground">
                        {label}
                    </label>
                )}
                {children}
                {hint && !error && (
                    <p id={messageId} className="text-xs text-muted-fg">
                        {hint}
                    </p>
                )}
                {error && (
                    <p id={messageId} className="animate-pop text-xs font-medium text-danger" role="alert">
                        {error}
                    </p>
                )}
            </div>
        </FieldContext>
    );
}
