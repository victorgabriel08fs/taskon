'use client';

import {
    DndContext,
    DragOverlay,
    KeyboardSensor,
    MouseSensor,
    TouchSensor,
    closestCorners,
    useSensor,
    useSensors,
    type Announcements,
    type CollisionDetection,
    type DataRef,
    type DragEndEvent,
    type DragOverEvent,
    type DragStartEvent,
    type ScreenReaderInstructions,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, horizontalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { CheckCheck, ClipboardList, Plus, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActiveCardContext } from '@/components/board/active-card';
import { ActivityPanel } from '@/components/board/activity-panel';
import { useComposer } from '@/components/board/add-card';
import { ArchivedModal } from '@/components/board/archived-modal';
import { BoardHeader } from '@/components/board/board-header';
import { CardItem, type CardDragData } from '@/components/board/card-item';
import { CardModal } from '@/components/board/card-modal';
import { ExportModal } from '@/components/board/export-modal';
import { EMPTY_FILTERS, matchesFilters, type BoardFilters } from '@/components/board/filters';
import { ListColumn, type DropzoneDragData, type ListDragData } from '@/components/board/list-column';
import { AppLayout } from '@/components/layouts/app-layout';
import { startNavigationProgress } from '@/components/navigation-progress';
import { useUser } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { runAction, showToast } from '@/lib/actions';
import { boardBackgroundClass } from '@/lib/palette';
import { cn, pluralize } from '@/lib/utils';
import { deleteBoard } from '@/server/actions/boards';
import { moveCard } from '@/server/actions/cards';
import { createList, deleteList, reorderLists } from '@/server/actions/lists';
import type {
    ActionResult,
    Activity,
    AutoArchiveConfig,
    Board,
    BoardBackground,
    BoardList,
    Card,
    CardDetail,
    ColorKey,
} from '@/types';

interface BoardShowProps {
    board: Board;
    backgrounds: BoardBackground[];
    colors: ColorKey[];
    autoArchive: AutoArchiveConfig;
    /** O histórico ainda pendente — o painel o lê com `use()` quando abre. */
    activity: Promise<Activity[]>;
    /** A página aninhada: a do card publica o `CardDetail` pela ponte (ver active-card.tsx). */
    children?: ReactNode;
}

type DragData = CardDragData | ListDragData | DropzoneDragData;

/** O `data` que cards, colunas e áreas de soltura registraram no dnd-kit. */
function dragData(entry: { data: DataRef } | null | undefined): DragData | null {
    return (entry?.data.current as DragData | undefined) ?? null;
}

/** Assinatura da ordenação — usada para não disparar request quando nada mudou. */
function signature(lists: BoardList[]): string {
    return lists.map((list) => `${list.id}:${list.cards.map((card) => card.id).join(',')}`).join('|');
}

function listIdOfCard(lists: BoardList[], cardId: number): number | null {
    return lists.find((list) => list.cards.some((card) => card.id === cardId))?.id ?? null;
}

const noop = () => {};

/**
 * O campo da lista nova só aparece porque a pessoa clicou em "Adicionar
 * lista", então o foco vai junto — no commit, como o `autoFocus` faria. Fixa,
 * fora do componente: uma função nova a cada render seria chamada de novo a
 * cada render, e o campo roubaria o foco de volta.
 */
const focusOnMount = (node: HTMLInputElement | null) => node?.focus();

/* -------------------------------------------------------------- acessibilidade */

/**
 * O dnd-kit narra o arraste para leitores de tela em inglês e pelo id cru
 * ("Picked up draggable item card:42"). Aqui ele fala português e diz o nome
 * do que se move — o título vem no `data` de cada card e coluna.
 */
function nameOf(entry: { data: DataRef } | null | undefined): string {
    const data = dragData(entry);

    if (!data) return 'o item';

    return data.type === 'card' ? `o card "${data.title}"` : `a lista "${data.title}"`;
}

const SCREEN_READER: ScreenReaderInstructions = {
    draggable:
        'Para pegar um item, pressione Espaço. Enquanto arrasta, use as setas para movê-lo. ' +
        'Pressione Espaço de novo para soltá-lo na nova posição, ou Esc para cancelar.',
};

const ANNOUNCEMENTS: Announcements = {
    onDragStart: ({ active }) => `Você pegou ${nameOf(active)}.`,
    onDragOver: ({ active, over }) =>
        over
            ? `Você está levando ${nameOf(active)} para ${nameOf(over)}.`
            : `Você está levando ${nameOf(active)}, fora de qualquer área de soltura.`,
    onDragEnd: ({ active, over }) =>
        over ? `Você soltou ${nameOf(active)} em ${nameOf(over)}.` : `Você soltou ${nameOf(active)}.`,
    onDragCancel: ({ active }) => `Arraste cancelado: ${nameOf(active)} voltou ao lugar de antes.`,
};

export function BoardShow({ board, backgrounds, colors, autoArchive, activity, children }: BoardShowProps) {
    const user = useUser();
    const router = useRouter();

    // O dnd-kit numera o `aria-describedby` com um contador de módulo, que no
    // SSR e no navegador anda diferente — um id fixo evita o erro de hidratação.
    const dndId = useId();

    // Espelho local das listas: é ele que se move durante o arraste. O servidor
    // vira a fonte da verdade de novo assim que a resposta chega.
    const [lists, setLists] = useState<BoardList[]>(board.lists);
    const [dragged, setDragged] = useState<{ type: 'card'; card: Card } | { type: 'list'; list: BoardList } | null>(null);
    const [filters, setFilters] = useState<BoardFilters>(EMPTY_FILTERS);
    const [showActivity, setShowActivity] = useState(false);
    const [selectMode, setSelectMode] = useState(false);
    const [selected, setSelected] = useState<Set<number>>(() => new Set());
    const [exportOpen, setExportOpen] = useState(false);
    const [archivedOpen, setArchivedOpen] = useState(false);

    // O card aberto (deep link). Quem preenche é a página do card, pela ponte.
    const [activeCard, setActiveCard] = useState<CardDetail | null>(null);

    const isDragging = useRef(false);
    const snapshot = useRef('');
    const serverLists = useRef(board.lists);
    // Uma resposta do servidor chegou durante o gesto e ficou fora do espelho.
    const missedSync = useRef(false);
    const { confirm, dialog } = useConfirm();

    useEffect(() => {
        serverLists.current = board.lists;

        // Uma resposta chegando no meio do gesto não pode puxar o card de
        // volta da mão de quem arrasta: ela entra quando o gesto acabar.
        if (isDragging.current) missedSync.current = true;
        else setLists(board.lists);
    }, [board.lists]);

    /** Volta o espelho ao que o servidor mandou por último. */
    const resync = useCallback(() => {
        missedSync.current = false;
        setLists(serverLists.current);
    }, []);

    /**
     * Grava um arraste. Se o servidor recusar (sem permissão, coluna que
     * sumiu, rede fora), o espelho volta ao estado dele — senão a tela
     * mostraria uma ordem que não foi salva.
     */
    const persist = useCallback(
        <T,>(call: () => Promise<ActionResult<T>>) => {
            void runAction(call, {
                // O `showProgress: false` do legado: o card já está onde a
                // pessoa soltou, e uma barra correndo sugeriria que não.
                progress: false,
                // O 422 vem sem toast (ele é para formulários), e o arraste não
                // tem campo onde mostrar o erro: a mensagem vira o aviso.
                onError: (result) => {
                    const message = result.errors ? Object.values(result.errors)[0] : undefined;

                    if (message && !result.toast) showToast({ type: 'error', message });
                },
            }).then((result) => {
                if (result?.ok) return;

                if (isDragging.current) missedSync.current = true;
                else resync();
            });
        },
        [resync],
    );

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
        const data = dragData(event.active);

        isDragging.current = true;
        missedSync.current = false;
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
        const active = dragData(event.active);
        const over = dragData(event.over);

        if (!over || active?.type !== 'card') return;

        const fromListId = listIdOfCard(lists, active.cardId);
        const toListId = over.type === 'card' ? listIdOfCard(lists, over.cardId) : over.listId;

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

        const active = dragData(event.active);
        const over = dragData(event.over);

        // Soltou fora de tudo: vale o que o servidor tem (o card pode ter
        // passado por outra coluna no caminho).
        if (!over || !active) {
            resync();

            return;
        }

        // Soltou onde estava: nada a gravar, mas o que o servidor mandou
        // durante o gesto (um card concluído ao entrar na coluna de conclusão,
        // a mudança de outro membro) precisa entrar agora.
        const settle = () => {
            if (missedSync.current) resync();
        };

        if (active.type === 'list') {
            const oldIndex = lists.findIndex((list) => list.id === active.listId);
            const newIndex = lists.findIndex((list) => list.id === over.listId);

            if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
                settle();

                return;
            }

            const next = arrayMove(lists, oldIndex, newIndex);

            setLists(next);
            persist(() => reorderLists({ boardId: board.id, ordered_ids: next.map((list) => list.id) }));

            return;
        }

        if (active.type !== 'card') return;

        const targetListId = over.type === 'card' ? listIdOfCard(lists, over.cardId) : over.listId;

        if (!targetListId) {
            resync();

            return;
        }

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

        if (signature(next) === snapshot.current) {
            settle();

            return;
        }

        const ordered = next.find((list) => list.id === targetListId)?.cards.map((card) => card.id) ?? [];

        persist(() => moveCard({ cardId: active.cardId, board_list_id: targetListId, ordered_ids: ordered }));
    };

    // O card aberto é uma rota, não um estado: F5 reabre, Voltar fecha, o link
    // é compartilhável. `scroll: false` é o `preserveScroll` do Inertia.
    const openCard = useCallback(
        (card: Card) => {
            const href = `/boards/${board.id}/cards/${card.id}`;

            startNavigationProgress(href);
            router.push(href, { scroll: false });
        },
        [router, board.id],
    );

    const closeCard = useCallback(() => {
        const href = `/boards/${board.id}`;

        startNavigationProgress(href);
        router.push(href, { scroll: false });
    }, [router, board.id]);

    const closeActivity = useCallback(() => setShowActivity(false), []);

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

    const exitSelectMode = () => {
        setSelectMode(false);
        setSelected(new Set());
    };

    // Os detalhes da exportação (descrição, checklists, comentários de todos
    // os cards) e a gaveta de arquivados não vêm com o quadro: cada modal pede
    // os seus ao abrir — a exportação uma vez só, a gaveta a cada abertura,
    // porque arquivar e restaurar mudam a lista.

    // Esc sai do modo seleção, mas não enquanto um diálogo está aberto por
    // cima (a exportação, o card, a gaveta, uma confirmação): lá o Esc é do
    // diálogo, e sair dos dois de uma vez perderia a seleção sem querer. O
    // mesmo vale para o painel de atividade: aberto, o Esc fecha só ele.
    useEffect(() => {
        if (!selectMode || showActivity) return;

        const onKey = (event: KeyboardEvent) => {
            // defaultPrevented: o Esc já fechou um popover (filtros, membros…).
            if (event.key !== 'Escape' || event.defaultPrevented) return;
            if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;

            setSelectMode(false);
            setSelected(new Set());
        };

        document.addEventListener('keydown', onKey);

        return () => document.removeEventListener('keydown', onKey);
    }, [selectMode, showActivity]);

    return (
        <ActiveCardContext value={setActiveCard}>
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
                        onOpenArchived={() => setArchivedOpen(true)}
                        onDeleteBoard={() =>
                            confirm({
                                title: 'Excluir este quadro?',
                                description: 'Todas as listas, cards e comentários vão junto. Não dá para desfazer.',
                                confirmLabel: 'Excluir quadro',
                                // A action redireciona para /boards com o aviso.
                                onConfirm: () => void runAction(() => deleteBoard({ boardId: board.id })),
                            })
                        }
                    />
                }
            >
                <DndContext
                    id={dndId}
                    sensors={sensors}
                    collisionDetection={collisionDetection}
                    accessibility={{ announcements: ANNOUNCEMENTS, screenReaderInstructions: SCREEN_READER }}
                    onDragStart={onDragStart}
                    onDragOver={onDragOver}
                    onDragEnd={onDragEnd}
                    onDragCancel={() => {
                        isDragging.current = false;
                        setDragged(null);
                        resync();
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
                                            onConfirm: () => void runAction(() => deleteList({ listId: target.id })),
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
                                <CardItem card={dragged.card} board={board} onOpen={noop} overlay />
                            </div>
                        )}

                        {dragged?.type === 'list' && (
                            <div className="w-[19rem] rotate-2 rounded-xl bg-surface-2/95 p-2 shadow-[var(--shadow-float)] ring-2 ring-primary/50">
                                <p className="px-2 py-1 text-sm font-semibold">{dragged.list.title}</p>
                                <p className="px-2 pb-1 text-xs text-muted-fg">
                                    {pluralize(dragged.list.cards.length, 'card', 'cards')}
                                </p>
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
                    onExport={() => setExportOpen(true)}
                    onExit={exitSelectMode}
                />

                {/* Sempre montado: quando a ponte devolve null, o modal anima a saída. */}
                <CardModal card={activeCard} board={board} colors={colors} onClose={closeCard} />

                <ExportModal
                    open={exportOpen}
                    board={board}
                    selected={selected}
                    onToggleCard={(id) => setSelected((current) => new Set([...current].filter((item) => item !== id)))}
                    onClose={() => setExportOpen(false)}
                />

                <ArchivedModal
                    open={archivedOpen}
                    board={board}
                    config={autoArchive}
                    onClose={() => setArchivedOpen(false)}
                />

                <ActivityPanel open={showActivity} onClose={closeActivity} activity={activity} />

                {dialog}

                {children}
            </AppLayout>
        </ActiveCardContext>
    );
}

/**
 * Faixa horizontal das colunas. As sombras nas bordas aparecem só quando ainda
 * há conteúdo para aquele lado — dica visual barata de que dá para rolar.
 */
function BoardCanvas({ children }: { children: ReactNode }) {
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

    // Enter cria e já libera o campo para a próxima lista, mesmo com a
    // anterior ainda a caminho (ver useComposer).
    const { title, setTitle, submit } = useComposer((value) => createList({ boardId, title: value }));

    const close = () => {
        setOpen(false);
        setTitle('');
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
                ref={focusOnMount}
                value={title}
                maxLength={120}
                aria-label="Nome da lista"
                placeholder="Nome da lista…"
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') submit();
                    if (event.key === 'Escape') close();
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
                    onClick={close}
                    className="rounded-md p-1.5 text-muted-fg transition-colors hover:bg-surface-3 hover:text-foreground"
                >
                    <X className="size-4" />
                </button>
            </div>
        </div>
    );
}
