'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import type { TrendPoint } from '@/types';

const WIDTH = 660;
const HEIGHT = 200;
const PAD_X = 6;
const PAD_TOP = 16;
const PAD_BOTTOM = 26;

const dayFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
const fullFormatter = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
});

/**
 * O dia chega como "2026-08-13", sem fuso. `new Date('2026-08-13')` é
 * meia-noite UTC — no fuso de São Paulo, 21:00 do dia 12 —, e o rótulo
 * mostraria o dia anterior. Ancorar ao meio-dia UTC e formatar em UTC dá o
 * mesmo texto no servidor (UTC, na Vercel) e no navegador, em qualquer fuso:
 * o SSR e a hidratação concordam.
 */
function parse(date: string): Date {
    return new Date(`${date}T12:00:00Z`);
}

/**
 * Curva suave com tangente horizontal nos pontos: os pontos de controle ficam
 * no meio do caminho em x, mantendo o y de cada ponta. Não passa do valor
 * máximo em lugar nenhum, ao contrário de um spline solto — num gráfico de
 * contagem, uma curva que sobe acima do pico é mentira visual.
 */
function smoothPath(points: { x: number; y: number }[]): string {
    if (points.length === 0) return '';

    return points.reduce((path, point, index) => {
        if (index === 0) return `M ${point.x} ${point.y}`;

        const previous = points[index - 1];
        const middle = (previous.x + point.x) / 2;

        return `${path} C ${middle} ${previous.y}, ${middle} ${point.y}, ${point.x} ${point.y}`;
    }, '');
}

export function TrendChart({ points }: { points: TrendPoint[] }) {
    const [active, setActive] = useState<number | null>(null);

    const { completedLine, completedArea, createdLine, coords, max } = useMemo(() => {
        const max = Math.max(1, ...points.flatMap((point) => [point.created, point.completed]));
        const span = points.length > 1 ? (WIDTH - PAD_X * 2) / (points.length - 1) : 0;
        const height = HEIGHT - PAD_TOP - PAD_BOTTOM;

        const x = (index: number) => PAD_X + index * span;
        const y = (value: number) => HEIGHT - PAD_BOTTOM - (value / max) * height;

        const completed = points.map((point, index) => ({ x: x(index), y: y(point.completed) }));
        const created = points.map((point, index) => ({ x: x(index), y: y(point.created) }));
        const line = smoothPath(completed);

        return {
            max,
            coords: completed.map((point, index) => ({ ...point, createdY: created[index].y })),
            completedLine: line,
            completedArea: `${line} L ${x(points.length - 1)} ${HEIGHT - PAD_BOTTOM} L ${x(0)} ${HEIGHT - PAD_BOTTOM} Z`,
            createdLine: smoothPath(created),
        };
    }, [points]);

    const current = active !== null ? points[active] : null;
    // Rótulo preso longe das bordas para o balão não vazar do cartão.
    const tooltipLeft = active !== null ? Math.min(Math.max((active / (points.length - 1)) * 100, 9), 91) : 0;

    return (
        <div>
            <div className="flex items-center justify-end gap-4 text-xs text-muted-fg">
                <Legend color="var(--primary)" label="Concluídos" />
                <Legend color="var(--muted-fg)" label="Criados" dashed />
            </div>

            <div
                className="relative mt-2"
                onPointerLeave={() => setActive(null)}
                onPointerMove={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    const ratio = (event.clientX - rect.left) / rect.width;

                    setActive(Math.min(points.length - 1, Math.max(0, Math.round(ratio * (points.length - 1)))));
                }}
            >
                <svg
                    viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                    className="w-full touch-none select-none overflow-visible"
                    role="img"
                    aria-label={`Cards criados e concluídos nos últimos ${points.length} dias`}
                >
                    <defs>
                        <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.28" />
                            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
                        </linearGradient>
                    </defs>

                    {/* Grade: três linhas bastam para dar escala sem virar papel milimetrado. */}
                    {[0, 0.5, 1].map((step) => {
                        const y = HEIGHT - PAD_BOTTOM - step * (HEIGHT - PAD_TOP - PAD_BOTTOM);

                        return (
                            <g key={step}>
                                <line
                                    x1={PAD_X}
                                    x2={WIDTH - PAD_X}
                                    y1={y}
                                    y2={y}
                                    stroke="var(--border)"
                                    strokeDasharray="3 6"
                                    vectorEffect="non-scaling-stroke"
                                />
                                <text x={PAD_X} y={y - 5} className="fill-[var(--muted-fg)] text-[11px] opacity-70">
                                    {Math.round(step * max)}
                                </text>
                            </g>
                        );
                    })}

                    <motion.path
                        d={completedArea}
                        fill="url(#trend-fill)"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.5, delay: 0.45 }}
                    />

                    <motion.path
                        d={createdLine}
                        fill="none"
                        stroke="var(--muted-fg)"
                        strokeWidth="2"
                        strokeDasharray="5 5"
                        strokeLinecap="round"
                        opacity="0.55"
                        vectorEffect="non-scaling-stroke"
                        initial={{ pathLength: 0 }}
                        animate={{ pathLength: 1 }}
                        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                    />

                    <motion.path
                        d={completedLine}
                        fill="none"
                        stroke="var(--primary)"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke"
                        initial={{ pathLength: 0 }}
                        animate={{ pathLength: 1 }}
                        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                    />

                    {active !== null && (
                        <g>
                            <line
                                x1={coords[active].x}
                                x2={coords[active].x}
                                y1={PAD_TOP - 6}
                                y2={HEIGHT - PAD_BOTTOM}
                                stroke="var(--border)"
                                vectorEffect="non-scaling-stroke"
                            />
                            <circle
                                cx={coords[active].x}
                                cy={coords[active].createdY}
                                r="4"
                                fill="var(--surface)"
                                stroke="var(--muted-fg)"
                                strokeWidth="2"
                            />
                            <circle
                                cx={coords[active].x}
                                cy={coords[active].y}
                                r="5"
                                fill="var(--surface)"
                                stroke="var(--primary)"
                                strokeWidth="2.5"
                            />
                        </g>
                    )}

                    {/* Rótulos de data: um a cada três dias, mais o último. */}
                    {points.map((point, index) =>
                        index % 3 === 0 || index === points.length - 1 ? (
                            <text
                                key={point.date}
                                x={coords[index].x}
                                y={HEIGHT - 8}
                                textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}
                                className="fill-[var(--muted-fg)] text-[11px]"
                            >
                                {dayFormatter.format(parse(point.date))}
                            </text>
                        ) : null,
                    )}
                </svg>

                <AnimatePresence>
                    {current && (
                        <motion.div
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.14 }}
                            style={{ left: `${tooltipLeft}%` }}
                            className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-lg bg-foreground px-2.5 py-1.5 text-background shadow-lg"
                        >
                            <p className="text-[11px] font-semibold capitalize">
                                {fullFormatter.format(parse(current.date))}
                            </p>
                            <p className="mt-0.5 whitespace-nowrap text-[11px] opacity-80">
                                {current.completed} concluído(s) · {current.created} criado(s)
                            </p>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}

function Legend({ color, label, dashed = false }: { color: string; label: string; dashed?: boolean }) {
    return (
        <span className="inline-flex items-center gap-1.5">
            <span
                className="h-0.5 w-4 rounded-full"
                style={
                    dashed
                        ? { backgroundImage: `repeating-linear-gradient(90deg, ${color} 0 4px, transparent 4px 7px)` }
                        : { backgroundColor: color }
                }
            />
            {label}
        </span>
    );
}
