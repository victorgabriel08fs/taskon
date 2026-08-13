import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { router } from '@inertiajs/react';
import { CircleCheckBig, GripVertical, MoreHorizontal, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { AddCard } from '@/components/board/add-card';
import { CardItem } from '@/components/board/card-item';
import { Button } from '@/components/ui/button';
import { Popover, PopoverItem } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { Board, BoardList, Card } from '@/types';

interface ListColumnProps {
    list: BoardList;
    board: Board;
    cards: Card[];
    onOpenCard: (card: Card) => void;
    onDelete: (list: BoardList) => void;
    /** true quando o filtro escondeu cards desta lista. */
    filtered: boolean;
}

export function ListColumn({ list, board, cards, onOpenCard, onDelete, filtered }: ListColumnProps) {
    const sortable = useSortable({ id: `list:${list.id}`, data: { type: 'list', listId: list.id } });

    // Área de soltura que cobre a coluna inteira — é o que permite largar um
    // card numa lista vazia.
    const dropzone = useDroppable({ id: `dropzone:${list.id}`, data: { type: 'dropzone', listId: list.id } });

    const [editing, setEditing] = useState(false);
    const [title, setTitle] = useState(list.title);
    const input = useRef<HTMLInputElement>(null);

    const overLimit = list.card_limit !== null && cards.length > list.card_limit;

    const saveTitle = () => {
        const value = title.trim();

        setEditing(false);

        if (!value || value === list.title) {
            setTitle(list.title);

            return;
        }

        router.patch(
            `/lists/${list.id}`,
            { title: value },
            { preserveScroll: true, preserveState: true, only: ['board'] },
        );
    };

    return (
        <div
            ref={sortable.setNodeRef}
            style={{ transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition }}
            className={cn(
                'group/col flex max-h-full w-[19rem] shrink-0 flex-col rounded-xl bg-surface-2/95 shadow-lg ring-1 ring-black/5 backdrop-blur-sm',
                'dark:bg-surface/90',
                sortable.isDragging && 'opacity-40',
                dropzone.isOver && 'ring-2 ring-primary/60',
            )}
        >
            {/* ------------------------------------------------------ cabeçalho */}
            <header className="flex items-center gap-1 px-2 pt-2">
                <button
                    ref={sortable.setActivatorNodeRef}
                    {...sortable.attributes}
                    {...sortable.listeners}
                    aria-label={`Mover lista ${list.title}`}
                    className="cursor-grab touch-none rounded p-1 text-muted-fg opacity-0 transition-opacity duration-150 hover:bg-surface-3 focus-visible:opacity-100 active:cursor-grabbing group-hover/col:opacity-70"
                >
                    <GripVertical className="size-4" />
                </button>

                {editing ? (
                    <input
                        ref={input}
                        autoFocus
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        onBlur={saveTitle}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') saveTitle();
                            if (event.key === 'Escape') {
                                setTitle(list.title);
                                setEditing(false);
                            }
                        }}
                        className="min-w-0 flex-1 rounded-md bg-surface px-2 py-1 text-sm font-semibold ring-2 ring-primary focus:outline-none"
                    />
                ) : (
                    <button
                        type="button"
                        onClick={() => setEditing(true)}
                        className="min-w-0 flex-1 truncate rounded-md px-2 py-1 text-left text-sm font-semibold transition-colors hover:bg-surface-3"
                    >
                        {list.title}
                    </button>
                )}

                {/* Sinaliza a coluna que conclui o card ao receber um arrasto —
                    sem isso o comportamento seria invisível até acontecer. */}
                {list.is_done && (
                    <span
                        title="Cards arrastados para cá são marcados como concluídos"
                        className="shrink-0 text-success"
                    >
                        <CircleCheckBig className="size-3.5" />
                    </span>
                )}

                <span
                    className={cn(
                        'shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
                        overLimit ? 'bg-danger/15 text-danger' : 'text-muted-fg',
                    )}
                    title={list.card_limit ? `Limite: ${list.card_limit}` : undefined}
                >
                    {cards.length}
                    {list.card_limit !== null && `/${list.card_limit}`}
                </span>

                <Popover
                    align="right"
                    className="w-56"
                    title={list.title}
                    trigger={({ toggle }) => (
                        <button
                            type="button"
                            onClick={toggle}
                            aria-label="Ações da lista"
                            className="shrink-0 rounded-md p-1.5 text-muted-fg transition-colors hover:bg-surface-3 hover:text-foreground"
                        >
                            <MoreHorizontal className="size-4" />
                        </button>
                    )}
                >
                    {({ close }) => (
                        <ListMenu
                            list={list}
                            onRename={() => {
                                close();
                                setEditing(true);
                            }}
                            onDelete={() => {
                                close();
                                onDelete(list);
                            }}
                        />
                    )}
                </Popover>
            </header>

            {/* ---------------------------------------------------------- cards */}
            <div
                ref={dropzone.setNodeRef}
                className="min-h-[3rem] flex-1 space-y-2 overflow-y-auto overscroll-contain px-2 py-2"
            >
                <SortableContext items={cards.map((card) => `card:${card.id}`)} strategy={verticalListSortingStrategy}>
                    {cards.map((card) => (
                        <CardItem key={card.id} card={card} board={board} onOpen={onOpenCard} />
                    ))}
                </SortableContext>

                {cards.length === 0 && (
                    <p className="rounded-lg border border-dashed border-border/70 px-3 py-6 text-center text-xs text-muted-fg">
                        {filtered ? 'Nada corresponde ao filtro' : 'Solte um card aqui'}
                    </p>
                )}
            </div>

            <footer className="px-2 pb-2">
                <AddCard listId={list.id} />
            </footer>
        </div>
    );
}

/** Conteúdo do menu "…" da coluna. Vive separado por causa do estado do limite. */
function ListMenu({
    list,
    onRename,
    onDelete,
}: {
    list: BoardList;
    onRename: () => void;
    onDelete: () => void;
}) {
    const [editingLimit, setEditingLimit] = useState(false);
    const [limit, setLimit] = useState(String(list.card_limit ?? ''));

    const saveLimit = () => {
        const value = limit.trim();

        router.patch(
            `/lists/${list.id}`,
            { card_limit: value === '' ? null : Number(value) },
            { preserveScroll: true, preserveState: true, only: ['board'] },
        );

        setEditingLimit(false);
    };

    return (
        <>
            <PopoverItem onClick={onRename}>Renomear lista</PopoverItem>

            {editingLimit ? (
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        saveLimit();
                    }}
                    className="animate-pop space-y-2 p-1.5"
                >
                    <input
                        autoFocus
                        type="number"
                        min={1}
                        max={999}
                        value={limit}
                        placeholder="Sem limite"
                        onChange={(event) => setLimit(event.target.value)}
                        onKeyDown={(event) => event.key === 'Escape' && setEditingLimit(false)}
                        className="w-full rounded-lg bg-surface-2 px-2.5 py-1.5 text-sm ring-1 ring-border focus:outline-none focus:ring-2 focus:ring-primary"
                    />

                    <div className="flex gap-2">
                        <Button type="submit" size="sm" className="flex-1">
                            Salvar
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                                setLimit('');
                                saveLimit();
                            }}
                        >
                            Remover
                        </Button>
                    </div>
                </form>
            ) : (
                <PopoverItem onClick={() => setEditingLimit(true)}>
                    {list.card_limit ? `Limite: ${list.card_limit} cards` : 'Definir limite de cards'}
                </PopoverItem>
            )}

            <PopoverItem
                icon={<CircleCheckBig className={cn('size-4', list.is_done && 'text-success')} />}
                onClick={() =>
                    router.patch(
                        `/lists/${list.id}`,
                        { is_done: !list.is_done },
                        { preserveScroll: true, preserveState: true, only: ['board'] },
                    )
                }
            >
                {list.is_done ? 'Não concluir mais aqui' : 'Concluir cards nesta coluna'}
            </PopoverItem>

            <div className="my-1 h-px bg-border" />

            <PopoverItem danger icon={<Trash2 className="size-4" />} onClick={onDelete}>
                Excluir lista
            </PopoverItem>
        </>
    );
}
