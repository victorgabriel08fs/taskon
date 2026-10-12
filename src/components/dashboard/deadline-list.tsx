'use client';

import { CalendarCheck2, Clock3 } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { boardBackgroundClass } from '@/lib/palette';
import { cn, dueState, formatDateTime, formatRelative, type DueState } from '@/lib/utils';
import type { Deadline } from '@/types';

const BADGE: Record<DueState, string> = {
    overdue: 'bg-danger/12 text-danger',
    soon: 'bg-warning/15 text-warning',
    upcoming: 'bg-surface-3 text-muted-fg',
    done: 'bg-success/12 text-success',
    none: 'bg-surface-3 text-muted-fg',
};

export function DeadlineList({ deadlines }: { deadlines: Deadline[] }) {
    if (deadlines.length === 0) {
        return (
            <div className="grid place-items-center gap-2 py-10 text-center">
                <span className="grid size-11 place-items-center rounded-full bg-success/12 text-success">
                    <CalendarCheck2 className="size-5" />
                </span>
                <p className="text-sm font-medium">Nenhum prazo à vista.</p>
                <p className="max-w-[16rem] text-xs text-muted-fg">
                    Tarefas com data de entrega atribuídas a você aparecem aqui.
                </p>
            </div>
        );
    }

    return (
        <ul className="space-y-1">
            {deadlines.map((deadline, index) => {
                const state = dueState(deadline.due_at, deadline.completed_at);

                return (
                    <motion.li
                        key={deadline.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.36, delay: index * 0.05, ease: [0.22, 1, 0.36, 1] }}
                    >
                        {/* Link direto para o card: abre o quadro com o modal já aberto. */}
                        <Link
                            href={`/boards/${deadline.board_id}/cards/${deadline.id}`}
                            className="group flex items-center gap-3 rounded-lg p-2 transition-colors duration-200 hover:bg-surface-2"
                        >
                            <span
                                className={cn(
                                    'h-9 w-1.5 shrink-0 rounded-full',
                                    boardBackgroundClass(deadline.board_background),
                                )}
                            />

                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium group-hover:text-primary">
                                    {deadline.title}
                                </p>
                                <p className="truncate text-[11px] text-muted-fg">
                                    {deadline.board_title} › {deadline.list_title}
                                </p>
                            </div>

                            {/* O selo depende do relógio ("em 3 horas", a cor da virada
                                do dia), que anda entre o SSR e a hidratação. */}
                            <span
                                title={formatDateTime(deadline.due_at)}
                                className={cn(
                                    'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold',
                                    BADGE[state],
                                )}
                                suppressHydrationWarning
                            >
                                <Clock3 className="size-3" />
                                {formatRelative(deadline.due_at)}
                            </span>
                        </Link>
                    </motion.li>
                );
            })}
        </ul>
    );
}
