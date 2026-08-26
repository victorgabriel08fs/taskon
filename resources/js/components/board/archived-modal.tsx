import { router } from '@inertiajs/react';
import { Archive, ArchiveRestore, CalendarClock, CircleCheckBig } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { cn, formatDate, formatRelative, pluralize } from '@/lib/utils';
import type { ArchivedCard, Board } from '@/types';

/** O que o servidor deixa a tela oferecer — ver config/taskon.php › auto_archive. */
export interface AutoArchiveConfig {
    /** Prazos em dias. A lista é a mesma que o backend valida. */
    options: number[];
    /** Horário da varredura, no fuso do app. */
    at: string;
}

interface ArchivedModalProps {
    open: boolean;
    board: Board;
    config: AutoArchiveConfig;
    /** Ausente enquanto a prop opcional `archivedCards` não chegou. */
    cards?: ArchivedCard[];
    onClose: () => void;
}

/**
 * Restaurar mexe no quadro E na gaveta: as duas props precisam voltar juntas,
 * senão o card reaparece na coluna e continua listado aqui como arquivado.
 */
const RELOAD = { preserveScroll: true, preserveState: true, only: ['board', 'archivedCards'] };

export function dayLabel(days: number): string {
    return pluralize(days, 'dia', 'dias');
}

/**
 * A gaveta dos arquivados — e o painel de controle do que vai parar nela.
 *
 * As duas coisas moram na mesma tela de propósito: o prazo só faz sentido ao
 * lado da consequência dele. Quem acabou de escolher "7 dias" vê logo abaixo o
 * que já saiu do quadro, e o botão de restaurar deixa a decisão reversível sem
 * sair do lugar.
 */
export function ArchivedModal({ open, board, config, cards, onClose }: ArchivedModalProps) {
    const days = board.auto_archive_days;

    const setDays = (value: number | null) =>
        router.patch(`/boards/${board.id}`, { auto_archive_done_after_days: value }, RELOAD);

    return (
        <Modal open={open} onClose={onClose} className="max-w-2xl" labelledBy="archived-title">
            <div className="flex max-h-[86vh] flex-col">
                <header className="flex items-center gap-2.5 border-b border-border px-6 py-4">
                    <Archive className="size-4.5 text-muted-fg" />
                    <h2 id="archived-title" className="flex-1 text-base font-bold">
                        Arquivados
                    </h2>
                    {board.archived_count > 0 && (
                        <span className="mr-8 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold tabular-nums text-muted-fg">
                            {board.archived_count}
                        </span>
                    )}
                </header>

                {board.can.manage && (
                    <section className="border-b border-border bg-surface-2/60 px-6 py-4">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-fg">
                            Tirar os concluídos do quadro
                        </p>

                        <div className="mt-2 flex flex-wrap gap-1.5">
                            <PrazoButton active={days === null} onClick={() => setDays(null)}>
                                Nunca
                            </PrazoButton>

                            {config.options.map((option) => (
                                <PrazoButton
                                    key={option}
                                    active={days === option}
                                    onClick={() => setDays(option)}
                                >
                                    {dayLabel(option)}
                                </PrazoButton>
                            ))}
                        </div>

                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                            <p className="max-w-md text-xs leading-relaxed text-muted-fg">
                                {days === null ? (
                                    <>
                                        Nada sai daqui sozinho. Os concluídos ficam na coluna até alguém
                                        arquivá-los na mão.
                                    </>
                                ) : (
                                    <>
                                        Todo dia às {config.at}, os cards concluídos há mais de{' '}
                                        <span className="font-semibold text-foreground">{dayLabel(days)}</span> saem
                                        das colunas e vêm para cá. Nada é apagado, e o progresso do quadro continua
                                        contando com eles.
                                    </>
                                )}
                            </p>

                            {days !== null && (
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => router.post(`/boards/${board.id}/archive-done`, {}, RELOAD)}
                                >
                                    <Archive className="size-4" />
                                    Arquivar agora
                                </Button>
                            )}
                        </div>
                    </section>
                )}

                <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
                    {cards === undefined ? (
                        <ul className="space-y-2">
                            {Array.from({ length: 4 }).map((_, index) => (
                                <li key={index} className="h-14 animate-pulse rounded-lg bg-surface-2" />
                            ))}
                        </ul>
                    ) : cards.length === 0 ? (
                        <p className="py-12 text-center text-sm text-muted-fg">
                            A gaveta está vazia — nenhum card saiu do quadro ainda.
                        </p>
                    ) : (
                        <>
                            <ul className="space-y-2">
                                <AnimatePresence initial={false}>
                                    {cards.map((card) => (
                                        <ArchivedRow key={card.id} card={card} />
                                    ))}
                                </AnimatePresence>
                            </ul>

                            {/* O teto da consulta é silencioso por padrão; dizer
                                quantos ficaram de fora evita a leitura de que a
                                gaveta inteira cabe nesta tela. */}
                            {board.archived_count > cards.length && (
                                <p className="mt-4 text-center text-xs text-muted-fg">
                                    Mostrando os {cards.length} mais recentes de {board.archived_count}.
                                </p>
                            )}
                        </>
                    )}
                </div>
            </div>
        </Modal>
    );
}

function PrazoButton({
    active,
    onClick,
    children,
}: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            aria-pressed={active}
            onClick={onClick}
            className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-150 active:scale-95',
                active
                    ? 'bg-primary text-primary-fg shadow-sm'
                    : 'bg-surface text-muted-fg ring-1 ring-border hover:text-foreground',
            )}
        >
            {children}
        </button>
    );
}

function ArchivedRow({ card }: { card: ArchivedCard }) {
    return (
        <motion.li
            layout
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
            transition={{ duration: 0.18 }}
            className="group flex items-center gap-3 rounded-lg bg-surface-2 px-3 py-2.5 ring-1 ring-transparent transition-shadow hover:ring-border"
        >
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{card.title}</p>

                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-fg">
                    <span>arquivado {formatRelative(card.archived_at)}</span>

                    {card.list_title && (
                        <span className="opacity-70">
                            · de <span className="font-medium">{card.list_title}</span>
                        </span>
                    )}

                    {card.completed_at && (
                        <span className="inline-flex items-center gap-1 text-success">
                            <CircleCheckBig className="size-3" />
                            concluído {formatRelative(card.completed_at)}
                        </span>
                    )}

                    {card.due_at && (
                        <span className="inline-flex items-center gap-1">
                            <CalendarClock className="size-3" />
                            {formatDate(card.due_at)}
                        </span>
                    )}
                </p>
            </div>

            <Button
                size="sm"
                variant="ghost"
                onClick={() => router.post(`/cards/${card.id}/restore`, {}, RELOAD)}
                title="Volta para o quadro reaberto, no fim da primeira coluna que não é de conclusão"
            >
                <ArchiveRestore className="size-4" />
                Restaurar
            </Button>
        </motion.li>
    );
}
