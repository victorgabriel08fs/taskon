import { Head, Link, router, useForm, usePage } from '@inertiajs/react';
import { LayoutGrid, Plus, Star } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { AvatarStack } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import AppLayout from '@/layouts/app-layout';
import { BOARD_BACKGROUND_LABEL, boardBackgroundClass } from '@/lib/palette';
import { cn, pluralize } from '@/lib/utils';
import type { BoardBackground, BoardSummary } from '@/types';

export default function BoardsIndex({
    boards,
    backgrounds,
}: {
    boards: BoardSummary[];
    backgrounds: BoardBackground[];
}) {
    const user = usePage().props.auth.user!;
    const [creating, setCreating] = useState(false);

    const favorites = boards.filter((board) => board.is_favorite);
    const others = boards.filter((board) => !board.is_favorite);

    return (
        <AppLayout>
            <Head title="Meus quadros" />

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

                <Section title={favorites.length > 0 ? 'Todos os quadros' : 'Seus quadros'} icon={<LayoutGrid className="size-4" />}>
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

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
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

function BoardCard({ board, index }: { board: BoardSummary; index: number }) {
    const progress = board.cards_count > 0 ? Math.round((board.done_count / board.cards_count) * 100) : 0;

    return (
        <motion.div
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.42, delay: Math.min(index, 8) * 0.045, ease: [0.22, 1, 0.36, 1] }}
        >
            <Link
                href={`/boards/${board.id}`}
                prefetch="hover"
                cacheFor="30s"
                className="group relative block overflow-hidden rounded-xl shadow-[var(--shadow-card)] ring-1 ring-border transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[var(--shadow-float)]"
            >
                <div className={cn('relative h-24', boardBackgroundClass(board.background))}>
                    <div className="absolute inset-0 bg-gradient-to-t from-black/35 to-transparent" />

                    <button
                        type="button"
                        aria-label={board.is_favorite ? 'Remover dos favoritos' : 'Marcar como favorito'}
                        onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            router.post(
                                `/boards/${board.id}/favorite`,
                                {},
                                { preserveScroll: true, preserveState: true },
                            );
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

function NewBoardTile({ onClick }: { onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
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

function CreateBoardModal({
    open,
    onClose,
    backgrounds,
}: {
    open: boolean;
    onClose: () => void;
    backgrounds: BoardBackground[];
}) {
    const form = useForm<{ title: string; background: BoardBackground }>({
        title: '',
        background: backgrounds[0] ?? 'aurora',
    });

    return (
        <Modal open={open} onClose={onClose} className="max-w-md">
            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    form.post('/boards', { onSuccess: () => { form.reset(); onClose(); } });
                }}
                className="p-6"
            >
                <h2 className="text-lg font-semibold">Novo quadro</h2>
                <p className="mt-1 text-sm text-muted-fg">Ele já nasce com três listas e etiquetas prontas.</p>

                <div className={cn('mt-5 h-28 rounded-xl shadow-inner', boardBackgroundClass(form.data.background))}>
                    <div className="flex h-full items-end p-4">
                        <p className="truncate text-base font-semibold text-white drop-shadow">
                            {form.data.title || 'Nome do quadro'}
                        </p>
                    </div>
                </div>

                <Field label="Título" error={form.errors.title} className="mt-5">
                    <Input
                        autoFocus
                        required
                        maxLength={120}
                        placeholder="Ex.: Lançamento do produto"
                        value={form.data.title}
                        onChange={(event) => form.setData('title', event.target.value)}
                    />
                </Field>

                <div className="mt-5">
                    <p className="text-sm font-medium">Fundo</p>
                    <div className="mt-2 grid grid-cols-4 gap-2">
                        {backgrounds.map((background) => (
                            <button
                                key={background}
                                type="button"
                                title={BOARD_BACKGROUND_LABEL[background]}
                                onClick={() => form.setData('background', background)}
                                className={cn(
                                    'h-12 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95',
                                    boardBackgroundClass(background),
                                    form.data.background === background &&
                                        'ring-2 ring-primary ring-offset-2 ring-offset-[var(--surface)]',
                                )}
                            />
                        ))}
                    </div>
                </div>

                <div className="mt-7 flex justify-end gap-2">
                    <Button type="button" variant="secondary" onClick={onClose}>
                        Cancelar
                    </Button>
                    <Button type="submit" loading={form.processing}>
                        Criar quadro
                    </Button>
                </div>
            </form>
        </Modal>
    );
}
