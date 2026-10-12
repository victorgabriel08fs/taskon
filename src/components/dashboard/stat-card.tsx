'use client';

import { TrendingDown, TrendingUp } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useCountUp } from '@/hooks/use-count-up';
import { cn } from '@/lib/utils';

export type Tone = 'danger' | 'warning' | 'primary' | 'success';

const TONES: Record<Tone, { chip: string; glow: string; ring: string }> = {
    danger: { chip: 'bg-danger/12 text-danger', glow: 'from-danger/18', ring: 'hover:ring-danger/35' },
    warning: { chip: 'bg-warning/15 text-warning', glow: 'from-warning/18', ring: 'hover:ring-warning/35' },
    primary: { chip: 'bg-primary-soft text-primary', glow: 'from-primary/18', ring: 'hover:ring-primary/35' },
    success: { chip: 'bg-success/12 text-success', glow: 'from-success/18', ring: 'hover:ring-success/35' },
};

interface StatCardProps {
    label: string;
    value: number;
    icon: ReactNode;
    tone: Tone;
    index: number;
    hint?: string;
    /** Variação percentual contra o período anterior. `null` esconde o selo. */
    trend?: number | null;
    href?: string;
}

export function StatCard({ label, value, icon, tone, index, hint, trend, href }: StatCardProps) {
    const count = useCountUp(value);
    const tones = TONES[tone];

    const card = (
        <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: index * 0.06, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
                'group relative isolate h-full overflow-hidden rounded-xl bg-surface p-4 ring-1 ring-border',
                'transition-all duration-300 hover:-translate-y-1 hover:shadow-[var(--shadow-card)]',
                tones.ring,
            )}
        >
            {/* Brilho que acende no hover. opacity só, sem repaint de layout. */}
            <div
                aria-hidden
                className={cn(
                    'pointer-events-none absolute -right-8 -top-10 -z-10 size-28 rounded-full bg-gradient-to-br to-transparent blur-2xl',
                    'opacity-0 transition-opacity duration-500 group-hover:opacity-100',
                    tones.glow,
                )}
            />

            <div className="flex items-start justify-between gap-2">
                <span
                    className={cn(
                        'grid size-9 place-items-center rounded-lg transition-transform duration-300 group-hover:scale-110',
                        tones.chip,
                    )}
                >
                    {icon}
                </span>

                {trend !== null && trend !== undefined && (
                    <span
                        className={cn(
                            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
                            trend >= 0 ? 'bg-success/12 text-success' : 'bg-danger/12 text-danger',
                        )}
                    >
                        {trend >= 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                        {trend >= 0 ? '+' : ''}
                        {trend}%
                    </span>
                )}
            </div>

            <motion.p className="mt-3 text-3xl font-bold leading-none tracking-tight tabular-nums">{count}</motion.p>

            <p className="mt-1.5 text-sm font-medium">{label}</p>
            {hint && <p className="mt-0.5 text-xs text-muted-fg">{hint}</p>}
        </motion.div>
    );

    return href ? (
        <Link href={href} className="block h-full">
            {card}
        </Link>
    ) : (
        card
    );
}
