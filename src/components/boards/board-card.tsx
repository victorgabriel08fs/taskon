'use client';

import { Star } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { AvatarStack } from '@/components/ui/avatar';
import { runAction } from '@/lib/actions';
import { boardBackgroundClass } from '@/lib/palette';
import { cn, pluralize } from '@/lib/utils';
import { toggleFavorite } from '@/server/actions/boards';
import type { BoardSummary } from '@/types';

/** O cartão de um quadro na grade: capa, progresso, membros e a estrela. */
export function BoardCard({ board, index }: { board: BoardSummary; index: number }) {
    const progress = board.cards_count > 0 ? Math.round((board.done_count / board.cards_count) * 100) : 0;

    return (
        <motion.div
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.42, delay: Math.min(index, 8) * 0.045, ease: [0.22, 1, 0.36, 1] }}
        >
            <Link
                href={`/boards/${board.id}`}
                className="group relative block overflow-hidden rounded-xl shadow-[var(--shadow-card)] ring-1 ring-border transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[var(--shadow-float)]"
            >
                <div className={cn('relative h-24', boardBackgroundClass(board.background))}>
                    <div className="absolute inset-0 bg-gradient-to-t from-black/35 to-transparent" />

                    <button
                        type="button"
                        aria-label={board.is_favorite ? 'Remover dos favoritos' : 'Marcar como favorito'}
                        onClick={(event) => {
                            // A estrela mora dentro do link do quadro: sem isto
                            // o clique também abriria o quadro. (A barra de
                            // navegação também a ignora — ver NESTED_CONTROLS em
                            // navigation-progress.tsx; a que aparece é a da action.)
                            event.preventDefault();
                            event.stopPropagation();
                            void runAction(() => toggleFavorite({ boardId: board.id }));
                        }}
                        className={cn(
                            'absolute right-2.5 top-2.5 rounded-lg p-1.5 backdrop-blur transition-all duration-200',
                            'hover:scale-115 active:scale-90',
                            board.is_favorite
                                ? 'bg-black/25 text-amber-300'
                                : 'bg-black/20 text-white/70 opacity-0 group-hover:opacity-100',
                        )}
                    >
                        <Star className={cn('size-4', board.is_favorite && 'fill-current')} />
                    </button>

                    <h3 className="absolute inset-x-0 bottom-0 truncate px-4 pb-3 text-base font-semibold text-white drop-shadow">
                        {board.title}
                    </h3>
                </div>

                <div className="bg-surface p-4">
                    <div className="flex items-center justify-between text-xs text-muted-fg">
                        <span>
                            {pluralize(board.lists_count, 'lista', 'listas')} ·{' '}
                            {pluralize(board.cards_count, 'card', 'cards')}
                        </span>
                        <span className="font-semibold text-foreground">{progress}%</span>
                    </div>

                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
                        <div
                            className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-[width] duration-700 ease-out"
                            style={{ width: `${progress}%` }}
                        />
                    </div>

                    <div className="mt-3.5 flex items-center justify-between">
                        <AvatarStack users={board.members} max={4} />
                        {board.role !== 'member' && (
                            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-fg">
                                {board.role === 'owner' ? 'Dono' : 'Admin'}
                            </span>
                        )}
                    </div>
                </div>
            </Link>
        </motion.div>
    );
}
