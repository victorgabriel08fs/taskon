'use client';

import { motion } from 'motion/react';
import { cn } from '@/lib/utils';

interface SwitchProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
    disabled?: boolean;
    label: string;
    className?: string;
}

/**
 * Interruptor com a bolinha animada por layout — a mola do motion faz a
 * transição parecer física em vez de linear.
 *
 * `label` vira aria-label: o botão não tem texto visível dentro dele.
 */
export function Switch({ checked, onChange, disabled = false, label, className }: SwitchProps) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            disabled={disabled}
            onClick={() => onChange(!checked)}
            className={cn(
                'relative inline-flex h-6.5 w-11.5 shrink-0 items-center rounded-full p-0.5',
                'transition-colors duration-300 ease-out disabled:opacity-50',
                'active:scale-95',
                checked ? 'bg-primary' : 'bg-surface-3',
                className,
            )}
        >
            <motion.span
                layout
                transition={{ type: 'spring', stiffness: 620, damping: 34 }}
                className={cn(
                    'size-5.5 rounded-full bg-white shadow-sm',
                    checked ? 'ml-auto' : 'mr-auto',
                )}
            />
        </button>
    );
}
