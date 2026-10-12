'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useAppearance } from '@/hooks/use-appearance';
import { cn } from '@/lib/utils';
import type { Appearance } from '@/types';

const OPTIONS: { value: Appearance; icon: typeof Sun; label: string; hint: string }[] = [
    { value: 'light', icon: Sun, label: 'Claro', hint: 'Fundo branco, ideal com muita luz.' },
    { value: 'dark', icon: Moon, label: 'Escuro', hint: 'Contraste suave para longas sessões.' },
    { value: 'system', icon: Monitor, label: 'Sistema', hint: 'Segue a preferência do sistema operacional.' },
];

/**
 * Claro, escuro ou sistema. Não passa pelo servidor: a escolha fica neste
 * navegador (localStorage + o cookie que deixa o SSR já pintar no tema certo).
 */
export function AppearancePicker() {
    const { appearance, updateAppearance } = useAppearance();

    return (
        <div className="grid gap-4 sm:grid-cols-3">
            {OPTIONS.map(({ value, icon: Icon, label, hint }) => (
                <button
                    key={value}
                    type="button"
                    onClick={() => updateAppearance(value)}
                    aria-pressed={appearance === value}
                    className={cn(
                        'group rounded-xl p-4 text-left ring-1 transition-all duration-200',
                        'hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)] active:translate-y-0',
                        appearance === value
                            ? 'bg-primary-soft ring-2 ring-primary'
                            : 'bg-surface ring-border hover:ring-primary/40',
                    )}
                >
                    <Icon
                        className={cn(
                            'size-5 transition-transform duration-300 group-hover:scale-110',
                            appearance === value ? 'text-primary' : 'text-muted-fg',
                        )}
                    />
                    <p className="mt-3 text-sm font-semibold">{label}</p>
                    <p className="mt-0.5 text-xs text-muted-fg">{hint}</p>
                </button>
            ))}
        </div>
    );
}
