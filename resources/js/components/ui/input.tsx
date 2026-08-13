import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const base =
    'w-full rounded-lg bg-surface px-3.5 py-2.5 text-sm text-foreground ring-1 ring-border ' +
    'placeholder:text-muted-fg/70 transition-all duration-150 ' +
    'hover:ring-border focus:outline-none focus:ring-2 focus:ring-primary ' +
    'disabled:cursor-not-allowed disabled:opacity-60';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
    { className, ...props },
    ref,
) {
    return <input ref={ref} className={cn(base, className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
    function Textarea({ className, ...props }, ref) {
        return <textarea ref={ref} className={cn(base, 'resize-y leading-relaxed', className)} {...props} />;
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
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div className={cn('space-y-1.5', className)}>
            {label && <label className="block text-sm font-medium text-foreground">{label}</label>}
            {children}
            {hint && !error && <p className="text-xs text-muted-fg">{hint}</p>}
            {error && (
                <p className="animate-pop text-xs font-medium text-danger" role="alert">
                    {error}
                </p>
            )}
        </div>
    );
}
