'use client';

import { motion } from 'motion/react';
import Link from 'next/link';
import { boardBackgroundClass } from '@/lib/palette';
import { cn, pluralize } from '@/lib/utils';
import type { BoardProgress } from '@/types';

export function BoardProgressList({ boards }: { boards: BoardProgress[] }) {
    if (boards.length === 0) {
        return <p className="py-6 text-center text-sm text-muted-fg">Nenhum quadro por aqui ainda.</p>;
    }

    return (
        <ul className="space-y-1">
            {boards.map((board, index) => {
                const percent = board.total > 0 ? Math.round((board.done / board.total) * 100) : 0;

                return (
                    <li key={board.id}>
                        <Link
                            href={`/boards/${board.id}`}
                            className="group flex items-center gap-3 rounded-lg p-2 transition-colors duration-200 hover:bg-surface-2"
                        >
                            <span
                                className={cn(
                                    'size-9 shrink-0 rounded-lg shadow-sm transition-transform duration-300 group-hover:scale-110',
                                    boardBackgroundClass(board.background),
                                )}
                            />

                            <div className="min-w-0 flex-1">
                                <div className="flex items-baseline justify-between gap-2">
                                    <p className="truncate text-sm font-medium">{board.title}</p>
                                    <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-fg">
                                        {percent}%
                                    </span>
                                </div>

                                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3">
                                    <motion.div
                                        initial={{ width: 0 }}
                                        animate={{ width: `${percent}%` }}
                                        transition={{
                                            duration: 0.8,
                                            delay: 0.15 + index * 0.07,
                                            ease: [0.22, 1, 0.36, 1],
                                        }}
                                        className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500"
                                    />
                                </div>

                                <p className="mt-1 flex items-center gap-2 text-[11px] text-muted-fg">
                                    <span>
                                        {board.done}/{board.total} {board.total === 1 ? 'card' : 'cards'}
                                    </span>
                                    {board.overdue > 0 && (
                                        <span className="rounded-full bg-danger/12 px-1.5 py-0.5 font-semibold text-danger">
                                            {pluralize(board.overdue, 'vencido', 'vencidos')}
                                        </span>
                                    )}
                                </p>
                            </div>
                        </Link>
                    </li>
                );
            })}
        </ul>
    );
}
