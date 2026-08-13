import { Monitor, Moon, Sun } from 'lucide-react';
import { motion } from 'motion/react';
import { useAppearance } from '@/hooks/use-appearance';
import { cn } from '@/lib/utils';
import type { Appearance } from '@/types';

const OPTIONS: { value: Appearance; icon: typeof Sun; label: string }[] = [
    { value: 'light', icon: Sun, label: 'Claro' },
    { value: 'dark', icon: Moon, label: 'Escuro' },
    { value: 'system', icon: Monitor, label: 'Sistema' },
];

export function ThemeToggle({ className }: { className?: string }) {
    const { appearance, updateAppearance } = useAppearance();

    return (
        <div className={cn('inline-flex rounded-lg bg-surface-2 p-0.5 ring-1 ring-border', className)}>
            {OPTIONS.map(({ value, icon: Icon, label }) => (
                <button
                    key={value}
                    type="button"
                    onClick={() => updateAppearance(value)}
                    title={label}
                    aria-label={label}
                    aria-pressed={appearance === value}
                    className="relative rounded-[0.55rem] px-2.5 py-1.5 text-muted-fg transition-colors hover:text-foreground"
                >
                    {appearance === value && (
                        <motion.span
                            layoutId="theme-pill"
                            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                            className="absolute inset-0 rounded-[0.55rem] bg-surface shadow-sm ring-1 ring-border"
                        />
                    )}
                    <Icon className={cn('relative size-4', appearance === value && 'text-primary')} />
                </button>
            ))}
        </div>
    );
}
