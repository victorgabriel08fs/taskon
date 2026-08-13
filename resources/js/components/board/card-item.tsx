import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlignLeft, CalendarClock, CheckSquare, MessageSquare } from 'lucide-react';
import { useRef } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { COLOR_CHIP, COLOR_SOLID } from '@/lib/palette';
import { cn, dueState, formatDate } from '@/lib/utils';
import type { Board, Card } from '@/types';

const DUE_STYLES: Record<string, string> = {
    overdue: 'bg-danger/15 text-danger',
    soon: 'bg-warning/18 text-amber-700 dark:text-amber-300',
    upcoming: 'bg-surface-3 text-muted-fg',
    done: 'bg-success/15 text-success',
};

interface CardItemProps {
    card: Card;
    board: Board;
    onOpen: (card: Card) => void;
    /** Renderização dentro do DragOverlay: sem sortable, com inclinação. */
    overlay?: boolean;
}

export function CardItem({ card, board, onOpen, overlay = false }: CardItemProps) {
    const sortable = useSortable({
        id: `card:${card.id}`,
        data: { type: 'card', cardId: card.id, listId: card.board_list_id },
        disabled: overlay,
    });

    // Diferencia clique de arraste: se o ponteiro andou, não abre o modal.
    const origin = useRef<{ x: number; y: number } | null>(null);

    const labels = board.labels.filter((label) => card.label_ids.includes(label.id));
    const members = board.members.filter((member) => card.member_ids.includes(member.id));
    const due = dueState(card.due_at, card.completed_at);
    const checklistDone = card.checklist_total > 0 && card.checklist_done === card.checklist_total;

    return (
        <article
            ref={overlay ? undefined : sortable.setNodeRef}
            style={
                overlay
                    ? undefined
                    : {
                          transform: CSS.Translate.toString(sortable.transform),
                          transition: sortable.transition,
                      }
            }
            {...(overlay ? {} : sortable.attributes)}
            {...(overlay ? {} : sortable.listeners)}
            onPointerDown={(event) => {
                origin.current = { x: event.clientX, y: event.clientY };
                // O spread acima já define onPointerDown; encadeamos em vez de sobrescrever.
                sortable.listeners?.onPointerDown?.(event);
            }}
            onClick={(event) => {
                const start = origin.current;
                const moved =
                    start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6;

                if (!moved) onOpen(card);
            }}
            className={cn(
                // touch-manipulation (e não touch-none): no celular o dedo continua
                // rolando a coluna; o arraste começa com toque longo.
                'group relative cursor-pointer touch-manipulation select-none overflow-hidden rounded-lg bg-surface',
                'ring-1 ring-border shadow-sm',
                'transition-[box-shadow,transform,opacity] duration-150 ease-out',
                'hover:-translate-y-0.5 hover:shadow-md hover:ring-primary/40',
                'focus-visible:ring-2 focus-visible:ring-primary',
                overlay && 'rotate-3 scale-[1.03] cursor-grabbing shadow-[var(--shadow-float)] ring-primary/50',
                !overlay && sortable.isDragging && 'opacity-30',
                card.completed_at && 'opacity-75',
            )}
        >
            {card.cover_color && <div className={cn('h-2 w-full', COLOR_SOLID[card.cover_color])} />}

            <div className="space-y-2 p-2.5">
                {labels.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                        {labels.map((label) => (
                            <span
                                key={label.id}
                                title={label.name ?? undefined}
                                className={cn(
                                    'inline-flex h-4 items-center rounded px-1.5 text-[10px] font-semibold ring-1',
                                    COLOR_CHIP[label.color],
                                )}
                            >
                                {label.name}
                            </span>
                        ))}
                    </div>
                )}

                <p
                    className={cn(
                        'text-sm leading-snug text-foreground',
                        card.completed_at && 'text-muted-fg line-through',
                    )}
                >
                    {card.title}
                </p>

                {(card.due_at || card.has_description || card.comments_count > 0 || card.checklist_total > 0 || members.length > 0) && (
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[11px] text-muted-fg">
                        {card.due_at && (
                            <span
                                className={cn(
                                    'inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium',
                                    DUE_STYLES[due],
                                )}
                            >
                                <CalendarClock className="size-3" />
                                {formatDate(card.due_at)}
                            </span>
                        )}

                        {card.has_description && <AlignLeft className="size-3.5" aria-label="Tem descrição" />}

                        {card.comments_count > 0 && (
                            <span className="inline-flex items-center gap-1">
                                <MessageSquare className="size-3.5" />
                                {card.comments_count}
                            </span>
                        )}

                        {card.checklist_total > 0 && (
                            <span
                                className={cn(
                                    'inline-flex items-center gap-1 rounded px-1 py-0.5 font-medium',
                                    checklistDone && 'bg-success/15 text-success',
                                )}
                            >
                                <CheckSquare className="size-3.5" />
                                {card.checklist_done}/{card.checklist_total}
                            </span>
                        )}

                        {members.length > 0 && (
                            <span className="ml-auto flex -space-x-1.5">
                                {members.slice(0, 3).map((member) => (
                                    <Avatar key={member.id} user={member} size="xs" ring />
                                ))}
                            </span>
                        )}
                    </div>
                )}
            </div>
        </article>
    );
}
