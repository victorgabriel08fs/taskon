import {
    DndContext,
    DragOverlay,
    KeyboardSensor,
    MouseSensor,
    TouchSensor,
    closestCorners,
    useSensor,
    useSensors,
    type CollisionDetection,
    type DragEndEvent,
    type DragOverEvent,
    type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, horizontalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { Head, router, usePage } from '@inertiajs/react';
import { CheckCheck, ClipboardList, Plus, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityPanel } from '@/components/board/activity-panel';
import { ArchivedModal, type AutoArchiveConfig } from '@/components/board/archived-modal';
import { BoardHeader } from '@/components/board/board-header';
import { CardItem } from '@/components/board/card-item';
import { CardModal } from '@/components/board/card-modal';
import { ExportModal } from '@/components/board/export-modal';
import { ListColumn } from '@/components/board/list-column';
import { EMPTY_FILTERS, matchesFilters, type BoardFilters } from '@/components/board/filters';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import AppLayout from '@/layouts/app-layout';
import { boardBackgroundClass } from '@/lib/palette';
import { cn, pluralize } from '@/lib/utils';
import type {
    Activity,
    ArchivedCard,
    Board,
    BoardBackground,
    BoardList,
    Card,
    CardDetail,
    CardExportDetail,
    ColorKey,
} from '@/types';

interface BoardShowProps {
    board: Board;
    activeCard: CardDetail | null;
    backgrounds: BoardBackground[];
    colors: ColorKey[];
    autoArchive: AutoArchiveConfig;
    activity?: Activity[];
    /** Prop `optional`: chega só quando a exportação a pede. */
    exportDetails?: CardExportDetail[];
    /** Prop `optional`: chega só quando a gaveta de arquivados é aberta. */
    archivedCards?: ArchivedCard[];
}

/** Assinatura da ordenação — usada para não disparar request quando nada mudou. */
function signature(lists: BoardList[]): string {
    return lists.map((list) => `${list.id}:${list.cards.map((card) => card.id).join(',')}`).join('|');
}

function listIdOfCard(lists: BoardList[], cardId: number): number | null {
    return lists.find((list) => list.cards.some((card) => card.id === cardId))?.id ?? null;
}

export default function BoardShow({
    board,
    activeCard,
    backgrounds,
    colors,
    autoArchive,
    activity,
    exportDetails,
    archivedCards,
}: BoardShowProps) {
    const user = usePage().props.auth.user!;

    // Espelho local das listas: é ele que se move durante o arraste. O servidor
    // vira a fonte da verdade de novo assim que a resposta chega.
    const [lists, setLists] = useState<BoardList[]>(board.lists);
    const [dragged, setDragged] = useState<{ type: 'card'; card: Card } | { type: 'list'; list: BoardList } | null>(null);
    const [filters, setFilters] = useState<BoardFilters>(EMPTY_FILTERS);
    const [showActivity, setShowActivity] = useState(false);
    const [selectMode, setSelectMode] = useState(false);
    const [selected, setSelected] = useState<Set<number>>(new Set());
    const [exportOpen, setExportOpen] = useState(false);
    const [archivedOpen, setArchivedOpen] = useState(false);

    const isDragging = useRef(false);
    const snapshot = useRef('');
    const { confirm, dialog } = useConfirm();

    useEffect(() => {
        if (!isDragging.current) setLists(board.lists);
    }, [board.lists]);

    const sensors = useSensors(
        // 6px de tolerância no mouse: clicar no card continua abrindo o card.
        useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
        // No toque, arraste só depois de segurar — senão o gesto de rolar a
        // coluna viraria um arraste acidental.
        useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
        // Acessibilidade: Tab até o card, Espaço pega, setas movem, Espaço solta.
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );

    /**
     * Colunas e cards convivem no mesmo DndContext, então a detecção de colisão
     * ignora os alvos do outro tipo — sem isso um card "grudaria" na coluna.
     */
    const collisionDetection = useCallback<CollisionDetection>((args) => {
        const type = args.active.data.current?.type;

        return closestCorners({
            ...args,
            droppableContainers: args.droppableContainers.filter((container) =>
                type === 'list'
                    ? container.data.current?.type === 'list'
                    : container.data.current?.type !== 'list',
            ),
        });
    }, []);

    const onDragStart = (event: DragStartEvent) => {
        const data = event.active.data.current;

        isDragging.current = true;
        snapshot.current = signature(lists);

        if (data?.type === 'card') {
            const card = lists.flatMap((list) => list.cards).find((item) => item.id === data.cardId);

            if (card) setDragged({ type: 'card', card });
        } else if (data?.type === 'list') {
            const list = lists.find((item) => item.id === data.listId);

            if (list) setDragged({ type: 'list', list });
        }
    };

    /** Movimentação entre colunas acontece já no hover, não só ao soltar. */
    const onDragOver = (event: DragOverEvent) => {
        const active = event.active.data.current;
        const over = event.over?.data.current;

        if (!over || active?.type !== 'card') return;

        const fromListId = listIdOfCard(lists, active.cardId);
        const toListId = over.type === 'card' ? listIdOfCard(lists, over.cardId) : (over.listId as number);

        if (!fromListId || !toListId || fromListId === toListId) return;

        setLists((current) => {
            const card = current.find((l) => l.id === fromListId)?.cards.find((c) => c.id === active.cardId);

            if (!card) return current;

            return current.map((list) => {
                if (list.id === fromListId) {
                    return { ...list, cards: list.cards.filter((item) => item.id !== card.id) };
                }

                if (list.id === toListId) {
                    const index = over.type === 'card' ? list.cards.findIndex((c) => c.id === over.cardId) : -1;
                    const cards = [...list.cards];

                    cards.splice(index === -1 ? cards.length : index, 0, { ...card, board_list_id: toListId });

                    return { ...list, cards };
                }

                return list;
            });
        });
    };

    const onDragEnd = (event: DragEndEvent) => {
        isDragging.current = false;
        setDragged(null);

        const active = event.active.data.current;
        const over = event.over?.data.current;

        if (!over || !active) {
            setLists(board.lists);

            return;
        }

        if (active.type === 'list') {
            const oldIndex = lists.findIndex((list) => list.id === active.listId);
            const newIndex = lists.findIndex((list) => list.id === over.listId);

            if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

            const next = arrayMove(lists, oldIndex, newIndex);

            setLists(next);
            router.patch(
                `/boards/${board.id}/lists/reorder`,
                { ordered_ids: next.map((list) => list.id) },
                { preserveScroll: true, preserveState: true, only: ['board'], showProgress: false },
            );

            return;
        }

        const targetListId = over.type === 'card' ? listIdOfCard(lists, over.cardId) : (over.listId as number);

        if (!targetListId) return;

        let next = lists;
        const target = lists.find((list) => list.id === targetListId);

        if (target && over.type === 'card') {
            const oldIndex = target.cards.findIndex((card) => card.id === active.cardId);
            const newIndex = target.cards.findIndex((card) => card.id === over.cardId);

            if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
                next = lists.map((list) =>
                    list.id === targetListId ? { ...list, cards: arrayMove(list.cards, oldIndex, newIndex) } : list,
                );
                setLists(next);
            }
        }

        if (signature(next) === snapshot.current) return;

        const ordered = next.find((list) => list.id === targetListId)?.cards.map((card) => card.id) ?? [];

        router.patch(
            `/cards/${active.cardId}/move`,
            { board_list_id: targetListId, ordered_ids: ordered },
            { preserveScroll: true, preserveState: true, only: ['board'], showProgress: false },
        );
    };

    const openCard = (card: Card) =>
        router.get(
            `/boards/${board.id}/cards/${card.id}`,
            {},
            { preserveState: true, preserveScroll: true, only: ['activeCard'] },
        );

    const closeCard = () =>
        router.get(
            `/boards/${board.id}`,
            {},
            { preserveState: true, preserveScroll: true, only: ['activeCard'] },
        );

    const visibleCards = useMemo(() => {
        const map = new Map<number, Card[]>();

        lists.forEach((list) => {
            map.set(
                list.id,
                list.cards.filter((card) => matchesFilters(card, filters, user.id)),
            );
        });

        return map;
    }, [lists, filters, user.id]);

    /* ------------------------------------------------------------ exportação */

    const onScreen = useMemo(() => [...visibleCards.values()].flat(), [visibleCards]);
    const allPicked = onScreen.length > 0 && onScreen.every((card) => selected.has(card.id));

    const toggleCard = useCallback((card: Card) => {
        setSelected((current) => {
            const next = new Set(current);

            // `delete` devolve false quando o card ainda não estava marcado.
            if (!next.delete(card.id)) next.add(card.id);

            return next;
        });
    }, []);

    const toggleMany = useCallback((cards: Card[]) => {
        setSelected((current) => {
            const next = new Set(current);
            const filled = cards.length > 0 && cards.every((card) => next.has(card.id));

            cards.forEach((card) => (filled ? next.delete(card.id) : next.add(card.id)));

            return next;
        });
    }, []);

    const openExport = () => {
        setExportOpen(true);

        // `exportDetails` é uma prop `optional`: ela só existe depois deste
        // pedido e, uma vez recebida, fica nas props — daí pedir uma vez só.
        if (!exportDetails) router.reload({ only: ['exportDetails'] });
    };

    /*
    ---------------------------------------------------------------- arquivados
    */

    // Ao contrário da exportação, a gaveta é pedida SEMPRE que abre: arquivar e
    // restaurar mudam a lista, e uma cópia velha ofereceria "Restaurar" num
    // card que já voltou para a coluna.
    const openArchived = () => {
        setArchivedOpen(true);
        router.reload({ only: ['archivedCards'] });
    };

    // Esc sai do modo seleção, mas não enquanto o modal está aberto: lá o Esc
    // é do modal, e sair dos dois de uma vez perderia a seleção sem querer.
    useEffect(() => {
        if (!selectMode || exportOpen) return;

        const onKey = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;

            setSelectMode(false);
            setSelected(new Set());
        };

        document.addEventListener('keydown', onKey);

        return () => document.removeEventListener('keydown', onKey);
    }, [selectMode, exportOpen]);

    return (
        <AppLayout
            overlay
            className={cn('relative isolate', boardBackgroundClass(board.background))}
            headerSlot={
                <BoardHeader
                    board={board}
                    backgrounds={backgrounds}
                    filters={filters}
                    onFiltersChange={setFilters}
                    onToggleActivity={() => setShowActivity((value) => !value)}
                    onStartExport={() => setSelectMode(true)}
                    onOpenArchived={openArchived}
                    onDeleteBoard={() =>
                        confirm({
                            title: 'Excluir este quadro?',
                            description: 'Todas as listas, cards e comentários vão junto. Não dá para desfazer.',
                            confirmLabel: 'Excluir quadro',
                            onConfirm: () => router.delete(`/boards/${board.id}`),
                        })
                    }
                />
            }
        >
            <Head title={board.title} />

            <DndContext
                sensors={sensors}
                collisionDetection={collisionDetection}
                onDragStart={onDragStart}
                onDragOver={onDragOver}
                onDragEnd={onDragEnd}
                onDragCancel={() => {
                    isDragging.current = false;
                    setDragged(null);
                    setLists(board.lists);
                }}
            >
                <BoardCanvas>
                    <SortableContext
                        items={lists.map((list) => `list:${list.id}`)}
                        strategy={horizontalListSortingStrategy}
                    >
                        {lists.map((list) => (
                            <ListColumn
                                key={list.id}
                                list={list}
                                board={board}
                                cards={visibleCards.get(list.id) ?? []}
                                onOpenCard={openCard}
                                filtered={(visibleCards.get(list.id)?.length ?? 0) !== list.cards.length}
                                selectMode={selectMode}
                                selected={selected}
                                onToggleCard={toggleCard}
                                onToggleList={toggleMany}
                                onDelete={(target) =>
                                    confirm({
                                        title: `Excluir "${target.title}"?`,
                                        description: 'Os cards dessa lista também serão removidos.',
                                        confirmLabel: 'Excluir lista',
                                        onConfirm: () =>
                                            router.delete(`/lists/${target.id}`, {
                                                preserveScroll: true,
                                                preserveState: true,
                                                only: ['board'],
                                            }),
                                    })
                                }
                            />
                        ))}
                    </SortableContext>

                    <AddList boardId={board.id} />
                </BoardCanvas>

                <DragOverlay dropAnimation={{ duration: 220, easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)' }}>
                    {dragged?.type === 'card' && (
                        <div className="w-[17.5rem]">
                            <CardItem card={dragged.card} board={board} onOpen={() => {}} overlay />
                        </div>
                    )}

                    {dragged?.type === 'list' && (
                        <div className="w-[19rem] rotate-2 rounded-xl bg-surface-2/95 p-2 shadow-[var(--shadow-float)] ring-2 ring-primary/50">
                            <p className="px-2 py-1 text-sm font-semibold">{dragged.list.title}</p>
                            <p className="px-2 pb-1 text-xs text-muted-fg">{dragged.list.cards.length} cards</p>
                        </div>
                    )}
                </DragOverlay>
            </DndContext>

            <SelectionBar
                open={selectMode}
                count={selected.size}
                allPicked={allPicked}
                onToggleAll={() => toggleMany(onScreen)}
                onClear={() => setSelected(new Set())}
                onExport={openExport}
                onExit={() => {
                    setSelectMode(false);
                    setSelected(new Set());
                }}
            />

            <CardModal card={activeCard} board={board} colors={colors} onClose={closeCard} />

            <ExportModal
                open={exportOpen}
                board={board}
                selected={selected}
                details={exportDetails}
                onToggleCard={(id) => setSelected((current) => new Set([...current].filter((item) => item !== id)))}
                onClose={() => setExportOpen(false)}
            />

            <ArchivedModal
                open={archivedOpen}
                board={board}
                config={autoArchive}
                cards={archivedCards}
                onClose={() => setArchivedOpen(false)}
            />

            <ActivityPanel open={showActivity} onClose={() => setShowActivity(false)} activity={activity} />

            {dialog}
        </AppLayout>
    );
}

/**
 * Faixa horizontal das colunas. As sombras nas bordas aparecem só quando ainda
 * há conteúdo para aquele lado — dica visual barata de que dá para rolar.
 */
function BoardCanvas({ children }: { children: React.ReactNode }) {
    const scroller = useRef<HTMLDivElement>(null);
    const [edges, setEdges] = useState({ start: false, end: false });

    useEffect(() => {
        const node = scroller.current;

        if (!node) return;

        const update = () => {
            const max = node.scrollWidth - node.clientWidth;

            setEdges({ start: node.scrollLeft > 8, end: node.scrollLeft < max - 8 });
        };

        update();
        node.addEventListener('scroll', update, { passive: true });

        const observer = new ResizeObserver(update);
        observer.observe(node);

        return () => {
            node.removeEventListener('scroll', update);
            observer.disconnect();
        };
    }, []);

    return (
        <div className="group/board relative min-h-0 flex-1">
            <div
                className={cn(
                    'pointer-events-none absolute inset-y-0 left-0 z-10 w-10 bg-gradient-to-r from-black/18 to-transparent transition-opacity duration-300',
                    edges.start ? 'opacity-100' : 'opacity-0',
                )}
            />
            <div
                className={cn(
                    'pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-gradient-to-l from-black/18 to-transparent transition-opacity duration-300',
                    edges.end ? 'opacity-100' : 'opacity-0',
                )}
            />

            <div
                ref={scroller}
                className="flex h-full items-start gap-3 overflow-x-auto overflow-y-hidden p-4 pb-5"
            >
                {children}
            </div>
        </div>
    );
}

/**
 * Barra do modo seleção. Flutua sobre o quadro em vez de empurrar as colunas:
 * entrar e sair do modo não pode remexer no layout que a pessoa está lendo.
 */
function SelectionBar({
    open,
    count,
    allPicked,
    onToggleAll,
    onClear,
    onExport,
    onExit,
}: {
    open: boolean;
    count: number;
    allPicked: boolean;
    onToggleAll: () => void;
    onClear: () => void;
    onExport: () => void;
    onExit: () => void;
}) {
    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    initial={{ opacity: 0, y: 24 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 16 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    className="pointer-events-none absolute inset-x-0 bottom-5 z-20 flex justify-center px-4"
                >
                    <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-1.5 rounded-xl bg-surface/95 p-2 pl-3.5 shadow-[var(--shadow-float)] ring-1 ring-border backdrop-blur">
                        <p className="text-sm font-semibold tabular-nums">
                            {count === 0
                                ? 'Escolha os cards do prompt'
                                : pluralize(count, 'card escolhido', 'cards escolhidos')}
                        </p>

                        <span className="mx-1 hidden h-5 w-px bg-border sm:block" />

                        <Button size="sm" variant="ghost" onClick={onToggleAll}>
                            <CheckCheck className="size-4" />
                            {allPicked ? 'Desmarcar visíveis' : 'Marcar visíveis'}
                        </Button>

                        {count > 0 && (
                            <Button size="sm" variant="ghost" onClick={onClear}>
                                Limpar
                            </Button>
                        )}

                        <Button size="sm" onClick={onExport} disabled={count === 0}>
                            <ClipboardList className="size-4" />
                            Gerar prompt
                        </Button>

                        <button
                            type="button"
                            onClick={onExit}
                            aria-label="Sair do modo de seleção"
                            className="rounded-md p-1.5 text-muted-fg transition-colors hover:bg-surface-2 hover:text-foreground"
                        >
                            <X className="size-4" />
                        </button>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

function AddList({ boardId }: { boardId: number }) {
    const [open, setOpen] = useState(false);
    const [title, setTitle] = useState('');

    const submit = () => {
        const value = title.trim();

        if (!value) return;

        router.post(
            `/boards/${boardId}/lists`,
            { title: value },
            {
                preserveScroll: true,
                preserveState: true,
                only: ['board'],
                onSuccess: () => setTitle(''),
            },
        );
    };

    if (!open) {
        return (
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="flex w-[19rem] shrink-0 items-center gap-2 rounded-xl bg-white/15 px-3 py-3 text-sm font-medium text-white ring-1 ring-white/20 backdrop-blur transition-all duration-200 hover:bg-white/25 active:scale-[0.98]"
            >
                <Plus className="size-4" />
                Adicionar lista
            </button>
        );
    }

    return (
        <div className="w-[19rem] shrink-0 animate-pop space-y-2 rounded-xl bg-surface-2/95 p-2 shadow-lg ring-1 ring-black/5 backdrop-blur dark:bg-surface/90">
            <input
                autoFocus
                value={title}
                placeholder="Nome da lista…"
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') submit();
                    if (event.key === 'Escape') {
                        setOpen(false);
                        setTitle('');
                    }
                }}
                className="w-full rounded-lg bg-surface px-2.5 py-2 text-sm font-medium ring-2 ring-primary focus:outline-none"
            />

            <div className="flex items-center gap-2">
                <Button size="sm" onClick={submit}>
                    Adicionar lista
                </Button>
                <button
                    type="button"
                    aria-label="Cancelar"
                    onClick={() => {
                        setOpen(false);
                        setTitle('');
                    }}
                    className="rounded-md p-1.5 text-muted-fg transition-colors hover:bg-surface-3 hover:text-foreground"
                >
                    <X className="size-4" />
                </button>
            </div>
        </div>
    );
}
