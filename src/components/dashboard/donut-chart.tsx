'use client';

import { animate, AnimatePresence, motion, useMotionTemplate, useMotionValue, useTransform } from 'motion/react';
import { useEffect, useState } from 'react';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { cn } from '@/lib/utils';

export interface DonutSegment {
    key: string;
    label: string;
    value: number;
    /** Cor CSS crua (var(--danger), etc.) — SVG não entende classe do Tailwind. */
    color: string;
}

const SIZE = 184;
const RADIUS = 72;
const STROKE = 18;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Respiro entre fatias, em unidades de comprimento do círculo. */
const GAP = 3;

export function DonutChart({ segments, caption }: { segments: DonutSegment[]; caption: string }) {
    const [active, setActive] = useState<string | null>(null);

    const visible = segments.filter((segment) => segment.value > 0);
    const total = visible.reduce((sum, segment) => sum + segment.value, 0);

    // O que aparece no miolo: a fatia sob o cursor, ou o total.
    const focus = visible.find((segment) => segment.key === active);
    const centerValue = focus ? focus.value : total;
    const centerLabel = focus ? focus.label : caption;

    // Cada fatia começa onde a anterior terminou. Laço comum, não um `map`
    // que reatribui variável de fora: callback de render precisa ser puro.
    const arcs: ArcProps['arc'][] = [];
    let cursor = 0;

    for (const segment of visible) {
        const length = (segment.value / total) * CIRCUMFERENCE;

        arcs.push({ ...segment, length, offset: cursor });
        cursor += length;
    }

    return (
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-6">
            <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
                <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="-rotate-90">
                    <circle
                        cx={SIZE / 2}
                        cy={SIZE / 2}
                        r={RADIUS}
                        fill="none"
                        stroke="var(--surface-2)"
                        strokeWidth={STROKE}
                        strokeDasharray={total === 0 ? '5 9' : undefined}
                    />

                    {arcs.map((arc, index) => (
                        <Arc
                            key={arc.key}
                            arc={arc}
                            index={index}
                            single={arcs.length === 1}
                            dimmed={active !== null && active !== arc.key}
                            onHover={() => setActive(arc.key)}
                            onLeave={() => setActive(null)}
                        />
                    ))}
                </svg>

                <div className="pointer-events-none absolute inset-0 grid place-content-center text-center">
                    <AnimatePresence mode="popLayout" initial={false}>
                        <motion.p
                            key={centerLabel}
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -6 }}
                            transition={{ duration: 0.18 }}
                            className="text-3xl font-bold leading-none tabular-nums"
                        >
                            {centerValue}
                        </motion.p>
                    </AnimatePresence>
                    <p className="mt-1 max-w-[7rem] text-[11px] font-medium leading-tight text-muted-fg">
                        {centerLabel}
                    </p>
                </div>
            </div>

            <ul className="w-full min-w-0 space-y-0.5">
                {segments.map((segment) => (
                    <li key={segment.key}>
                        <button
                            type="button"
                            onMouseEnter={() => setActive(segment.key)}
                            onMouseLeave={() => setActive(null)}
                            onFocus={() => setActive(segment.key)}
                            onBlur={() => setActive(null)}
                            className={cn(
                                'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors duration-150',
                                active === segment.key ? 'bg-surface-2' : 'hover:bg-surface-2',
                                segment.value === 0 && 'opacity-45',
                            )}
                        >
                            <span
                                className="size-2.5 shrink-0 rounded-full"
                                style={{ backgroundColor: segment.color }}
                            />
                            <span className="min-w-0 flex-1 truncate text-sm">{segment.label}</span>
                            <span className="text-sm font-semibold tabular-nums">{segment.value}</span>
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
}

interface ArcProps {
    arc: DonutSegment & { length: number; offset: number };
    index: number;
    single: boolean;
    dimmed: boolean;
    onHover: () => void;
    onLeave: () => void;
}

/**
 * Uma fatia.
 *
 * O crescimento anima o strokeDasharray via MotionValue em vez de estado do
 * React: o traço passa de 0 ao comprimento final sem re-renderizar o
 * componente a cada frame. O strokeDashoffset é estático e só posiciona a
 * fatia no anel.
 *
 * O bloco global de prefers-reduced-motion do CSS não alcança animação em JS,
 * então a checagem é explícita — e pelo `usePrefersReducedMotion`, que no SSR
 * e na hidratação responde "não" e só depois conta a verdade: o
 * `useReducedMotion` do motion responderia diferente no servidor e no
 * navegador, e o anel hidratado ficaria preso no traço vazio do SSR.
 */
function Arc({ arc, index, single, dimmed, onHover, onLeave }: ArcProps) {
    const reduced = usePrefersReducedMotion();
    const grow = useMotionValue(reduced ? 1 : 0);
    const length = single ? arc.length : Math.max(arc.length - GAP, 1);

    useEffect(() => {
        if (reduced) {
            grow.set(1);

            return;
        }

        const controls = animate(grow, 1, {
            duration: 0.85,
            delay: 0.12 + index * 0.09,
            ease: [0.22, 1, 0.36, 1],
        });

        return () => controls.stop();
    }, [grow, index, reduced]);

    const drawn = useTransform(grow, (value) => length * value);
    const dashArray = useMotionTemplate`${drawn} ${CIRCUMFERENCE}`;

    return (
        <motion.circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke={arc.color}
            strokeLinecap="round"
            strokeDashoffset={-arc.offset}
            style={{ strokeDasharray: dashArray }}
            animate={{ strokeWidth: dimmed ? STROKE - 5 : STROKE, opacity: dimmed ? 0.4 : 1 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            onMouseEnter={onHover}
            onMouseLeave={onLeave}
            className="cursor-pointer"
        />
    );
}
