import { AnimatePresence, motion } from 'motion/react';
import { History, X } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { formatRelative } from '@/lib/utils';
import type { Activity } from '@/types';

/**
 * Painel lateral com o histórico do quadro. `activity` chega como prop
 * adiada (Inertia::defer) — o quadro pinta primeiro, o feed entra depois.
 */
export function ActivityPanel({
    open,
    onClose,
    activity,
}: {
    open: boolean;
    onClose: () => void;
    activity?: Activity[];
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
                            {activity === undefined ? (
                                <ul className="space-y-4">
                                    {Array.from({ length: 6 }).map((_, index) => (
                                        <li key={index} className="flex gap-3">
                                            <span className="size-7 shrink-0 animate-pulse rounded-full bg-surface-3" />
                                            <span className="h-9 flex-1 animate-pulse rounded-lg bg-surface-3" />
                                        </li>
                                    ))}
                                </ul>
                            ) : activity.length === 0 ? (
                                <p className="py-10 text-center text-sm text-muted-fg">Nada por aqui ainda.</p>
                            ) : (
                                <ul className="space-y-4">
                                    {activity.map((item) => (
                                        <li key={item.id} className="flex gap-3">
                                            {item.user ? (
                                                <Avatar user={item.user} size="sm" />
                                            ) : (
                                                <span className="size-7 shrink-0 rounded-full bg-surface-3" />
                                            )}

                                            <p className="text-sm leading-relaxed text-muted-fg">
                                                <span className="font-medium text-foreground">
                                                    {item.user?.name ?? 'Sistema'}
                                                </span>{' '}
                                                {item.description}
                                                <span className="mt-0.5 block text-xs opacity-70">
                                                    {formatRelative(item.created_at)}
                                                </span>
                                            </p>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </motion.aside>
                </>
            )}
        </AnimatePresence>
    );
}
