'use client';

import { History, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Component, Suspense, use, type ReactNode } from 'react';
import { TimeAgo } from '@/components/time-ago';
import { Avatar } from '@/components/ui/avatar';
import type { Activity } from '@/types';

/**
 * Painel lateral com o histórico do quadro. `activity` chega como Promise
 * ainda pendente (o layout do quadro não espera por ela, como fazia o
 * `Inertia::defer`): o quadro pinta primeiro, o feed entra depois.
 */
export function ActivityPanel({
    open,
    onClose,
    activity,
}: {
    open: boolean;
    onClose: () => void;
    activity: Promise<Activity[]>;
}) {
    return (
        <AnimatePresence>
            {open && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 z-40 bg-slate-950/30"
                        aria-hidden
                    />

                    <motion.aside
                        initial={{ x: '100%' }}
                        animate={{ x: 0 }}
                        exit={{ x: '100%' }}
                        transition={{ type: 'spring', stiffness: 320, damping: 34 }}
                        className="fixed inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col bg-surface shadow-[var(--shadow-float)] ring-1 ring-border"
                    >
                        <header className="flex items-center gap-2.5 border-b border-border px-5 py-4">
                            <History className="size-4.5 text-muted-fg" />
                            <h2 className="flex-1 text-sm font-semibold">Atividade do quadro</h2>
                            <button
                                type="button"
                                onClick={onClose}
                                aria-label="Fechar"
                                className="rounded-lg p-1.5 text-muted-fg transition-colors hover:bg-surface-2 hover:text-foreground"
                            >
                                <X className="size-4" />
                            </button>
                        </header>

                        <div className="flex-1 overflow-y-auto px-5 py-4">
                            <FeedBoundary activity={activity}>
                                <Suspense fallback={<FeedSkeleton />}>
                                    <Feed activity={activity} />
                                </Suspense>
                            </FeedBoundary>
                        </div>
                    </motion.aside>
                </>
            )}
        </AnimatePresence>
    );
}

function Feed({ activity }: { activity: Promise<Activity[]> }) {
    const items = use(activity);

    if (items.length === 0) {
        return <p className="py-10 text-center text-sm text-muted-fg">Nada por aqui ainda.</p>;
    }

    return (
        <ul className="space-y-4">
            {items.map((item) => (
                <li key={item.id} className="flex gap-3">
                    {item.user ? (
                        <Avatar user={item.user} size="sm" />
                    ) : (
                        <span className="size-7 shrink-0 rounded-full bg-surface-3" />
                    )}

                    <p className="text-sm leading-relaxed text-muted-fg">
                        <span className="font-medium text-foreground">{item.user?.name ?? 'Sistema'}</span>{' '}
                        {item.description}
                        <TimeAgo iso={item.created_at} className="mt-0.5 block text-xs opacity-70" />
                    </p>
                </li>
            ))}
        </ul>
    );
}

/** O mesmo esqueleto de quando a prop adiada ainda não tinha chegado. */
function FeedSkeleton() {
    return (
        <ul className="space-y-4">
            {Array.from({ length: 6 }).map((_, index) => (
                <li key={index} className="flex gap-3">
                    <span className="size-7 shrink-0 animate-pulse rounded-full bg-surface-3" />
                    <span className="h-9 flex-1 animate-pulse rounded-lg bg-surface-3" />
                </li>
            ))}
        </ul>
    );
}

interface FeedBoundaryProps {
    activity: Promise<Activity[]>;
    children: ReactNode;
}

interface FeedBoundaryState {
    failed: boolean;
    activity: Promise<Activity[]>;
}

/**
 * Se a consulta do histórico falhar, o `use()` relança o erro — e, sem esta
 * fronteira, ele subiria até a tela de erro do app e levaria o quadro
 * inteiro junto. O histórico é acessório: falha aqui, fica aqui.
 *
 * Cada re-renderização do servidor (toda action chama `refresh()`) traz uma
 * Promise nova, e é ela que dá a segunda chance.
 */
class FeedBoundary extends Component<FeedBoundaryProps, FeedBoundaryState> {
    state: FeedBoundaryState = { failed: false, activity: this.props.activity };

    static getDerivedStateFromError(): Partial<FeedBoundaryState> {
        return { failed: true };
    }

    static getDerivedStateFromProps(props: FeedBoundaryProps, state: FeedBoundaryState): Partial<FeedBoundaryState> | null {
        return props.activity === state.activity ? null : { failed: false, activity: props.activity };
    }

    render() {
        if (this.state.failed) {
            return (
                <p className="py-10 text-center text-sm text-muted-fg">
                    Não foi possível carregar a atividade agora. Tente de novo em instantes.
                </p>
            );
        }

        return this.props.children;
    }
}
