'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { useRipple } from '@/hooks/use-ripple';
import { Loader2 } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'glass' | 'outline';
type Size = 'sm' | 'md' | 'lg' | 'icon';

const VARIANTS: Record<Variant, string> = {
    primary:
        'bg-primary text-primary-fg shadow-sm hover:brightness-110 active:brightness-95 disabled:opacity-50',
    secondary: 'bg-surface-2 text-foreground hover:bg-surface-3 ring-1 ring-border',
    outline: 'bg-transparent text-foreground ring-1 ring-border hover:bg-surface-2',
    ghost: 'bg-transparent text-muted-fg hover:bg-surface-2 hover:text-foreground',
    danger: 'bg-danger text-white shadow-sm hover:brightness-110',
    glass: 'glass text-foreground ring-1 ring-white/15 hover:bg-white/20',
};

const SIZES: Record<Size, string> = {
    sm: 'h-8 px-3 text-xs gap-1.5 rounded-md',
    md: 'h-10 px-4 text-sm gap-2 rounded-lg',
    lg: 'h-12 px-6 text-base gap-2.5 rounded-lg',
    icon: 'size-9 rounded-lg',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: Variant;
    size?: Size;
    loading?: boolean;
}

/**
 * Botão com feedback tátil: ripple na origem do clique + micro "afundada"
 * no :active. Ambos em CSS/transform, então não disputam a main thread.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    { className, variant = 'primary', size = 'md', loading = false, children, disabled, onPointerDown, ...props },
    ref,
) {
    const { ripples, spawn } = useRipple();

    return (
        <button
            ref={ref}
            disabled={disabled || loading}
            onPointerDown={(event) => {
                spawn(event);
                onPointerDown?.(event);
            }}
            className={cn(
                'relative isolate inline-flex select-none items-center justify-center overflow-hidden font-medium',
                'transition-[transform,filter,background-color,box-shadow] duration-150 ease-out',
                'active:scale-[0.97] disabled:pointer-events-none disabled:opacity-60',
                VARIANTS[variant],
                SIZES[size],
                className,
            )}
            {...props}
        >
            {ripples}
            {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {children}
        </button>
    );
});
