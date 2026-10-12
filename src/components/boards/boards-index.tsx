'use client';

import { LayoutGrid, Plus, Star } from 'lucide-react';
import { motion } from 'motion/react';
import { useState, type ReactNode } from 'react';
import { BoardCard } from '@/components/boards/board-card';
import { CreateBoardModal } from '@/components/boards/create-board-modal';
import { AppLayout } from '@/components/layouts/app-layout';
import { useUser } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { pluralize } from '@/lib/utils';
import type { BoardBackground, BoardSummary } from '@/types';

/**
 * "Meus quadros": os favoritos primeiro, depois o resto (a ordem — favorito,
 * último aberto, mais novo — já vem do servidor). Os números agregados e os
 * gráficos ficam no painel.
 */
export function BoardsIndex({ boards, backgrounds }: { boards: BoardSummary[]; backgrounds: BoardBackground[] }) {
    const user = useUser();
    const [creating, setCreating] = useState(false);

    const favorites = boards.filter((board) => board.is_favorite);
    const others = boards.filter((board) => !board.is_favorite);

    return (
        <AppLayout>
            <div className="mx-auto w-full max-w-6xl px-5 py-10">
                <motion.header
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                    className="flex flex-wrap items-end justify-between gap-4"
                >
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">Olá, {user.name.split(' ')[0]} 👋</h1>
                        <p className="mt-1 text-sm text-muted-fg">
                            {boards.length === 0
                                ? 'Vamos criar seu primeiro quadro?'
                                : `${pluralize(boards.length, 'quadro', 'quadros')} · ${pluralize(
                                      boards.reduce((total, board) => total + board.cards_count, 0),
                                      'card',
                                      'cards',
                                  )}`}
                        </p>
                    </div>

                    <Button onClick={() => setCreating(true)}>
                        <Plus className="size-4" />
                        Novo quadro
                    </Button>
                </motion.header>

                {favorites.length > 0 && (
                    <Section title="Favoritos" icon={<Star className="size-4 fill-amber-400 text-amber-400" />}>
                        {favorites.map((board, index) => (
                            <BoardCard key={board.id} board={board} index={index} />
                        ))}
                    </Section>
                )}

                <Section
                    title={favorites.length > 0 ? 'Todos os quadros' : 'Seus quadros'}
                    icon={<LayoutGrid className="size-4" />}
                >
                    {others.map((board, index) => (
                        <BoardCard key={board.id} board={board} index={index + favorites.length} />
                    ))}

                    <NewBoardTile onClick={() => setCreating(true)} />
                </Section>
            </div>

            <CreateBoardModal open={creating} onClose={() => setCreating(false)} backgrounds={backgrounds} />
        </AppLayout>
    );
}

function Section({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
    return (
        <section className="mt-10">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-fg">
                {icon}
                {title}
            </h2>

            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{children}</div>
        </section>
    );
}

function NewBoardTile({ onClick }: { onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label="Criar quadro"
            className="group grid min-h-[13rem] place-items-center rounded-xl border-2 border-dashed border-border bg-surface/40 text-muted-fg transition-all duration-300 hover:-translate-y-1.5 hover:border-primary/50 hover:bg-primary-soft/50 hover:text-primary"
        >
            <span className="flex flex-col items-center gap-2">
                <span className="grid size-11 place-items-center rounded-full bg-surface-2 transition-transform duration-300 group-hover:scale-115 group-hover:rotate-90">
                    <Plus className="size-5" />
                </span>
                <span className="text-sm font-medium">Criar quadro</span>
            </span>
        </button>
    );
}
