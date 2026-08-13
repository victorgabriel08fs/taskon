import { router } from '@inertiajs/react';
import {
    AlignLeft,
    Calendar,
    Check,
    CheckSquare,
    Circle,
    CircleCheckBig,
    History,
    MessageSquare,
    Paintbrush,
    Plus,
    Tags,
    Trash2,
    UserRound,
    X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { Modal } from '@/components/ui/modal';
import { Popover } from '@/components/ui/popover';
import { COLOR_CHIP, COLOR_SOLID } from '@/lib/palette';
import { cn, formatRelative, toDateTimeLocal } from '@/lib/utils';
import type { Board, CardDetail, ColorKey } from '@/types';

/** Toda mutação dentro do card recarrega só o quadro e o card aberto. */
const RELOAD = { preserveScroll: true, preserveState: true, only: ['board', 'activeCard'] };

type Payload = Record<string, string | number | boolean | null>;

export function CardModal({
    card,
    board,
    colors,
    onClose,
}: {
    card: CardDetail | null;
    board: Board;
    colors: ColorKey[];
    onClose: () => void;
}) {
    const { confirm, dialog } = useConfirm();

    return (
        <>
            <Modal open={card !== null} onClose={onClose} className="max-w-3xl" hideClose labelledBy="card-title">
                {card && <CardModalBody card={card} board={board} colors={colors} onClose={onClose} confirm={confirm} />}
            </Modal>
            {dialog}
        </>
    );
}

function CardModalBody({
    card,
    board,
    colors,
    onClose,
    confirm,
}: {
    card: CardDetail;
    board: Board;
    colors: ColorKey[];
    onClose: () => void;
    confirm: ReturnType<typeof useConfirm>['confirm'];
}) {
    const [title, setTitle] = useState(card.title);
    const [editingTitle, setEditingTitle] = useState(false);

    useEffect(() => setTitle(card.title), [card.id, card.title]);

    const labels = board.labels.filter((label) => card.label_ids.includes(label.id));
    const members = board.members.filter((member) => card.member_ids.includes(member.id));
    const done = card.completed_at !== null;

    const patch = (data: Payload) => router.patch(`/cards/${card.id}`, data, RELOAD);

    const saveTitle = () => {
        const value = title.trim();

        setEditingTitle(false);

        if (!value || value === card.title) {
            setTitle(card.title);

            return;
        }

        patch({ title: value });
    };

    return (
        <div className="max-h-[86vh] overflow-y-auto">
            {card.cover_color && <div className={cn('h-20 w-full rounded-t-xl', COLOR_SOLID[card.cover_color])} />}

            <button
                type="button"
                onClick={onClose}
                aria-label="Fechar"
                className="absolute right-3 top-3 z-10 rounded-lg bg-surface/80 p-1.5 text-muted-fg backdrop-blur transition-colors hover:bg-surface-2 hover:text-foreground"
            >
                <X className="size-4.5" />
            </button>

            <div className="grid gap-6 p-6 md:grid-cols-[1fr_13rem]">
                {/* ------------------------------------------------- coluna principal */}
                <div className="min-w-0 space-y-7">
                    <header>
                        <div className="flex items-start gap-3">
                            <button
                                type="button"
                                aria-label={done ? 'Reabrir card' : 'Marcar como concluído'}
                                onClick={() => patch({ is_completed: !done })}
                                className={cn(
                                    'mt-0.5 shrink-0 rounded-full transition-transform duration-200 hover:scale-115 active:scale-90',
                                    done ? 'text-success' : 'text-muted-fg hover:text-success',
                                )}
                            >
                                {done ? <CircleCheckBig className="size-6" /> : <Circle className="size-6" />}
                            </button>

                            {editingTitle ? (
                                <textarea
                                    autoFocus
                                    rows={2}
                                    value={title}
                                    onChange={(event) => setTitle(event.target.value)}
                                    onBlur={saveTitle}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter' && !event.shiftKey) {
                                            event.preventDefault();
                                            saveTitle();
                                        }
                                        if (event.key === 'Escape') {
                                            setTitle(card.title);
                                            setEditingTitle(false);
                                        }
                                    }}
                                    className="w-full resize-none rounded-lg bg-surface-2 px-2.5 py-1.5 text-xl font-bold ring-2 ring-primary focus:outline-none"
                                />
                            ) : (
                                <h2
                                    id="card-title"
                                    onClick={() => setEditingTitle(true)}
                                    className={cn(
                                        '-mx-2 cursor-text rounded-lg px-2 py-1 text-xl font-bold leading-snug transition-colors hover:bg-surface-2',
                                        done && 'text-muted-fg line-through',
                                    )}
                                >
                                    {card.title}
                                </h2>
                            )}
                        </div>

                        <p className="ml-9 mt-1 text-xs text-muted-fg">
                            na lista <span className="font-medium text-foreground">{card.list_title}</span>
                            {card.due_at && <> · vence {formatRelative(card.due_at)}</>}
                        </p>
                    </header>

                    {(labels.length > 0 || members.length > 0 || card.due_at) && (
                        <div className="ml-9 flex flex-wrap gap-x-8 gap-y-4">
                            {members.length > 0 && (
                                <div>
                                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-fg">
                                        Membros
                                    </p>
                                    <div className="flex -space-x-1.5">
                                        {members.map((member) => (
                                            <Avatar key={member.id} user={member} size="md" ring />
                                        ))}
                                    </div>
                                </div>
                            )}

                            {labels.length > 0 && (
                                <div>
                                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-fg">
                                        Etiquetas
                                    </p>
                                    <div className="flex flex-wrap gap-1.5">
                                        {labels.map((label) => (
                                            <span
                                                key={label.id}
                                                className={cn(
                                                    'rounded-md px-2 py-1 text-xs font-semibold ring-1',
                                                    COLOR_CHIP[label.color],
                                                )}
                                            >
                                                {label.name || 'Sem nome'}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {card.due_at && (
                                <div>
                                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-fg">
                                        Prazo
                                    </p>
                                    <input
                                        type="datetime-local"
                                        value={toDateTimeLocal(card.due_at)}
                                        onChange={(event) =>
                                            patch({ due_at: event.target.value ? event.target.value : null })
                                        }
                                        className="rounded-lg bg-surface-2 px-2.5 py-1.5 text-sm ring-1 ring-border focus:outline-none focus:ring-2 focus:ring-primary"
                                    />
                                </div>
                            )}
                        </div>
                    )}

                    <Description card={card} onSave={(description) => patch({ description })} />

                    <Checklists card={card} confirm={confirm} />

                    <Comments card={card} />

                    {card.activities.length > 0 && (
                        <section>
                            <SectionTitle icon={<History className="size-4" />}>Atividade</SectionTitle>

                            <ul className="ml-9 mt-3 space-y-2.5">
                                {card.activities.map((item) => (
                                    <li key={item.id} className="flex items-start gap-2.5 text-sm">
                                        {item.user && <Avatar user={item.user} size="sm" />}
                                        <p className="text-muted-fg">
                                            <span className="font-medium text-foreground">
                                                {item.user?.name ?? 'Alguém'}
                                            </span>{' '}
                                            {item.description}
                                            <span className="ml-1.5 text-xs opacity-70">
                                                {formatRelative(item.created_at)}
                                            </span>
                                        </p>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}
                </div>

                {/* ------------------------------------------------------ barra lateral */}
                <aside className="space-y-1.5">
                    <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-fg">Adicionar</p>

                    <SidePopover icon={<UserRound className="size-4" />} label="Membros" title="Membros do card">
                        {() =>
                            board.members.map((member) => {
                                const active = card.member_ids.includes(member.id);

                                return (
                                    <button
                                        key={member.id}
                                        type="button"
                                        onClick={() =>
                                            router.post(`/cards/${card.id}/members/${member.id}`, {}, RELOAD)
                                        }
                                        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-surface-2"
                                    >
                                        <Avatar user={member} size="sm" />
                                        <span className="min-w-0 flex-1 truncate">{member.name}</span>
                                        {active && <Check className="size-4 text-primary" />}
                                    </button>
                                );
                            })
                        }
                    </SidePopover>

                    <SidePopover icon={<Tags className="size-4" />} label="Etiquetas" title="Etiquetas">
                        {() => <LabelPicker card={card} board={board} colors={colors} />}
                    </SidePopover>

                    <SidePopover icon={<Calendar className="size-4" />} label="Prazo" title="Data de entrega">
                        {({ close }) => (
                            <div className="space-y-2 p-1.5">
                                <input
                                    type="datetime-local"
                                    defaultValue={toDateTimeLocal(card.due_at)}
                                    onChange={(event) =>
                                        router.patch(
                                            `/cards/${card.id}`,
                                            { due_at: event.target.value || null },
                                            RELOAD,
                                        )
                                    }
                                    className="w-full rounded-lg bg-surface-2 px-2.5 py-2 text-sm ring-1 ring-border focus:outline-none focus:ring-2 focus:ring-primary"
                                />

                                {card.due_at && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="w-full"
                                        onClick={() => {
                                            router.patch(`/cards/${card.id}`, { due_at: null }, RELOAD);
                                            close();
                                        }}
                                    >
                                        Remover prazo
                                    </Button>
                                )}
                            </div>
                        )}
                    </SidePopover>

                    <SidePopover icon={<Paintbrush className="size-4" />} label="Capa" title="Cor da capa">
                        {({ close }) => (
                            <div className="space-y-2 p-1.5">
                                <div className="grid grid-cols-5 gap-1.5">
                                    {colors.map((color) => (
                                        <button
                                            key={color}
                                            type="button"
                                            aria-label={color}
                                            onClick={() => {
                                                router.patch(`/cards/${card.id}`, { cover_color: color }, RELOAD);
                                                close();
                                            }}
                                            className={cn(
                                                'h-9 rounded-lg transition-transform duration-150 hover:scale-110 active:scale-95',
                                                COLOR_SOLID[color],
                                                card.cover_color === color && 'ring-2 ring-primary ring-offset-2 ring-offset-[var(--surface)]',
                                            )}
                                        />
                                    ))}
                                </div>

                                {card.cover_color && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="w-full"
                                        onClick={() => {
                                            router.patch(`/cards/${card.id}`, { cover_color: null }, RELOAD);
                                            close();
                                        }}
                                    >
                                        Remover capa
                                    </Button>
                                )}
                            </div>
                        )}
                    </SidePopover>

                    <AddChecklistButton cardId={card.id} />

                    <div className="pt-3">
                        <button
                            type="button"
                            onClick={() =>
                                confirm({
                                    title: 'Excluir este card?',
                                    description: 'Comentários e checklists vão junto.',
                                    confirmLabel: 'Excluir card',
                                    // O controller redireciona para o quadro; o
                                    // modal fecha sozinho quando activeCard some.
                                    onConfirm: () => router.delete(`/cards/${card.id}`, { preserveScroll: true }),
                                })
                            }
                            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/10"
                        >
                            <Trash2 className="size-4" />
                            Excluir card
                        </button>
                    </div>
                </aside>
            </div>
        </div>
    );
}

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
    return (
        <h3 className="flex items-center gap-2.5 text-sm font-semibold">
            <span className="grid size-6 place-items-center text-muted-fg">{icon}</span>
            {children}
        </h3>
    );
}

function SidePopover({
    icon,
    label,
    title,
    children,
}: {
    icon: React.ReactNode;
    label: string;
    title: string;
    children: (props: { close: () => void }) => React.ReactNode;
}) {
    return (
        <Popover
            align="right"
            title={title}
            className="w-64"
            trigger={({ toggle }) => (
                <button
                    type="button"
                    onClick={toggle}
                    className="flex w-full items-center gap-2.5 rounded-lg bg-surface-2 px-2.5 py-2 text-sm font-medium transition-all duration-150 hover:bg-surface-3 active:scale-[0.98]"
                >
                    {icon}
                    {label}
                </button>
            )}
        >
            {children}
        </Popover>
    );
}

/**
 * Marcar/desmarcar etiquetas e — para quem administra o quadro — criar e
 * excluir. Sem isso o usuário ficaria preso nas etiquetas iniciais.
 */
function LabelPicker({ card, board, colors }: { card: CardDetail; board: Board; colors: ColorKey[] }) {
    const [creating, setCreating] = useState(false);
    const [name, setName] = useState('');
    const [color, setColor] = useState<ColorKey>(colors[0] ?? 'violet');

    return (
        <div className="space-y-1">
            {board.labels.map((label) => {
                const active = card.label_ids.includes(label.id);

                return (
                    <div key={label.id} className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() => router.post(`/cards/${card.id}/labels/${label.id}`, {}, RELOAD)}
                            className={cn(
                                'flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-semibold ring-1 transition-transform duration-150 hover:scale-[1.02] active:scale-[0.99]',
                                COLOR_CHIP[label.color],
                            )}
                        >
                            <span className="min-w-0 flex-1 truncate">{label.name || 'Sem nome'}</span>
                            {active && <Check className="size-3.5" />}
                        </button>

                        {board.can.manage && (
                            <button
                                type="button"
                                aria-label={`Excluir etiqueta ${label.name ?? ''}`}
                                onClick={() => router.delete(`/labels/${label.id}`, RELOAD)}
                                className="rounded-md p-1.5 text-muted-fg transition-colors hover:bg-danger/10 hover:text-danger"
                            >
                                <Trash2 className="size-3.5" />
                            </button>
                        )}
                    </div>
                );
            })}

            {board.labels.length === 0 && !creating && (
                <p className="px-2 py-4 text-center text-xs text-muted-fg">
                    Este quadro ainda não tem etiquetas.
                </p>
            )}

            {board.can.manage && (
                <div className="border-t border-border pt-2">
                    {creating ? (
                        <form
                            onSubmit={(event) => {
                                event.preventDefault();
                                router.post(
                                    `/boards/${board.id}/labels`,
                                    { name: name.trim() || null, color },
                                    {
                                        ...RELOAD,
                                        onSuccess: () => {
                                            setName('');
                                            setCreating(false);
                                        },
                                    },
                                );
                            }}
                            className="animate-pop space-y-2"
                        >
                            <input
                                autoFocus
                                value={name}
                                maxLength={60}
                                placeholder="Nome da etiqueta"
                                onChange={(event) => setName(event.target.value)}
                                onKeyDown={(event) => event.key === 'Escape' && setCreating(false)}
                                className="w-full rounded-lg bg-surface-2 px-2.5 py-1.5 text-sm ring-1 ring-border focus:outline-none focus:ring-2 focus:ring-primary"
                            />

                            <div className="grid grid-cols-5 gap-1.5">
                                {colors.map((option) => (
                                    <button
                                        key={option}
                                        type="button"
                                        aria-label={option}
                                        onClick={() => setColor(option)}
                                        className={cn(
                                            'h-7 rounded-md transition-transform duration-150 hover:scale-110 active:scale-95',
                                            COLOR_SOLID[option],
                                            color === option &&
                                                'ring-2 ring-primary ring-offset-2 ring-offset-[var(--surface)]',
                                        )}
                                    />
                                ))}
                            </div>

                            <div className="flex gap-2">
                                <Button type="submit" size="sm" className="flex-1">
                                    Criar
                                </Button>
                                <Button type="button" size="sm" variant="ghost" onClick={() => setCreating(false)}>
                                    Cancelar
                                </Button>
                            </div>
                        </form>
                    ) : (
                        <button
                            type="button"
                            onClick={() => setCreating(true)}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-muted-fg transition-colors hover:bg-surface-2 hover:text-foreground"
                        >
                            <Plus className="size-4" />
                            Nova etiqueta
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

function Description({ card, onSave }: { card: CardDetail; onSave: (value: string) => void }) {
    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState(card.description ?? '');

    useEffect(() => {
        setValue(card.description ?? '');
        setEditing(false);
    }, [card.id, card.description]);

    return (
        <section>
            <SectionTitle icon={<AlignLeft className="size-4" />}>Descrição</SectionTitle>

            <div className="ml-9 mt-2">
                {editing ? (
                    <div className="space-y-2">
                        <textarea
                            autoFocus
                            rows={6}
                            value={value}
                            onChange={(event) => setValue(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Escape') {
                                    setValue(card.description ?? '');
                                    setEditing(false);
                                }
                            }}
                            placeholder="Detalhe o que precisa ser feito…"
                            className="w-full resize-y rounded-lg bg-surface-2 p-3 text-sm leading-relaxed ring-1 ring-border focus:outline-none focus:ring-2 focus:ring-primary"
                        />

                        <div className="flex items-center gap-2">
                            <Button
                                size="sm"
                                onClick={() => {
                                    onSave(value);
                                    setEditing(false);
                                }}
                            >
                                Salvar
                            </Button>
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                    setValue(card.description ?? '');
                                    setEditing(false);
                                }}
                            >
                                Cancelar
                            </Button>
                            <span className="text-[11px] text-muted-fg">Esc cancela</span>
                        </div>
                    </div>
                ) : (
                    <button
                        type="button"
                        onClick={() => setEditing(true)}
                        className={cn(
                            'w-full rounded-lg px-3 py-2.5 text-left text-sm leading-relaxed transition-colors',
                            card.description
                                ? 'whitespace-pre-wrap hover:bg-surface-2'
                                : 'bg-surface-2 text-muted-fg hover:bg-surface-3',
                        )}
                    >
                        {card.description || 'Adicionar uma descrição mais detalhada…'}
                    </button>
                )}
            </div>
        </section>
    );
}

function AddChecklistButton({ cardId }: { cardId: number }) {
    return (
        <Popover
            align="right"
            title="Nova checklist"
            className="w-64"
            trigger={({ toggle }) => (
                <button
                    type="button"
                    onClick={toggle}
                    className="flex w-full items-center gap-2.5 rounded-lg bg-surface-2 px-2.5 py-2 text-sm font-medium transition-all duration-150 hover:bg-surface-3 active:scale-[0.98]"
                >
                    <CheckSquare className="size-4" />
                    Checklist
                </button>
            )}
        >
            {({ close }) => (
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        const input = event.currentTarget.elements.namedItem('title') as HTMLInputElement;

                        if (!input.value.trim()) return;

                        router.post(`/cards/${cardId}/checklists`, { title: input.value.trim() }, RELOAD);
                        close();
                    }}
                    className="space-y-2 p-1.5"
                >
                    <input
                        name="title"
                        autoFocus
                        defaultValue="Checklist"
                        className="w-full rounded-lg bg-surface-2 px-2.5 py-2 text-sm ring-1 ring-border focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    <Button type="submit" size="sm" className="w-full">
                        Adicionar
                    </Button>
                </form>
            )}
        </Popover>
    );
}

function Checklists({
    card,
    confirm,
}: {
    card: CardDetail;
    confirm: ReturnType<typeof useConfirm>['confirm'];
}) {
    if (card.checklists.length === 0) return null;

    return (
        <div className="space-y-6">
            {card.checklists.map((checklist) => {
                const total = checklist.items.length;
                const done = checklist.items.filter((item) => item.is_done).length;
                const percent = total > 0 ? Math.round((done / total) * 100) : 0;

                return (
                    <section key={checklist.id}>
                        <div className="flex items-center gap-2">
                            <SectionTitle icon={<CheckSquare className="size-4" />}>{checklist.title}</SectionTitle>

                            <button
                                type="button"
                                aria-label="Excluir checklist"
                                onClick={() =>
                                    confirm({
                                        title: `Excluir "${checklist.title}"?`,
                                        confirmLabel: 'Excluir',
                                        onConfirm: () =>
                                            router.delete(`/checklists/${checklist.id}`, RELOAD),
                                    })
                                }
                                className="ml-auto rounded-md p-1.5 text-muted-fg transition-colors hover:bg-danger/10 hover:text-danger"
                            >
                                <Trash2 className="size-3.5" />
                            </button>
                        </div>

                        <div className="ml-9 mt-2">
                            <div className="flex items-center gap-3">
                                <span className="w-9 text-xs font-semibold tabular-nums text-muted-fg">{percent}%</span>
                                <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
                                    <motion.div
                                        className={cn(
                                            'h-full rounded-full',
                                            percent === 100
                                                ? 'bg-success'
                                                : 'bg-gradient-to-r from-violet-500 to-fuchsia-500',
                                        )}
                                        initial={false}
                                        animate={{ width: `${percent}%` }}
                                        transition={{ type: 'spring', stiffness: 260, damping: 30 }}
                                    />
                                </div>
                            </div>

                            <ul className="mt-3 space-y-0.5">
                                <AnimatePresence initial={false}>
                                    {checklist.items.map((item) => (
                                        <motion.li
                                            key={item.id}
                                            layout
                                            initial={{ opacity: 0, height: 0 }}
                                            animate={{ opacity: 1, height: 'auto' }}
                                            exit={{ opacity: 0, height: 0 }}
                                            transition={{ duration: 0.18 }}
                                            className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-2"
                                        >
                                            <button
                                                type="button"
                                                aria-label={item.is_done ? 'Desmarcar' : 'Marcar como feito'}
                                                onClick={() =>
                                                    router.patch(
                                                        `/checklist-items/${item.id}`,
                                                        { is_done: !item.is_done },
                                                        RELOAD,
                                                    )
                                                }
                                                className={cn(
                                                    'grid size-4.5 shrink-0 place-items-center rounded border-2 transition-all duration-200',
                                                    item.is_done
                                                        ? 'border-success bg-success text-white'
                                                        : 'border-border hover:border-primary',
                                                )}
                                            >
                                                {item.is_done && <Check className="size-3" strokeWidth={3} />}
                                            </button>

                                            <span
                                                className={cn(
                                                    'min-w-0 flex-1 text-sm',
                                                    item.is_done && 'text-muted-fg line-through',
                                                )}
                                            >
                                                {item.content}
                                            </span>

                                            <button
                                                type="button"
                                                aria-label="Remover item"
                                                onClick={() =>
                                                    router.delete(`/checklist-items/${item.id}`, RELOAD)
                                                }
                                                className="rounded p-1 text-muted-fg opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                                            >
                                                <X className="size-3.5" />
                                            </button>
                                        </motion.li>
                                    ))}
                                </AnimatePresence>
                            </ul>

                            <AddChecklistItem checklistId={checklist.id} />
                        </div>
                    </section>
                );
            })}
        </div>
    );
}

function AddChecklistItem({ checklistId }: { checklistId: number }) {
    const [open, setOpen] = useState(false);
    const [content, setContent] = useState('');
    const input = useRef<HTMLInputElement>(null);

    const submit = () => {
        const value = content.trim();

        if (!value) return;

        router.post(
            `/checklists/${checklistId}/items`,
            { content: value },
            {
                ...RELOAD,
                onSuccess: () => {
                    setContent('');
                    requestAnimationFrame(() => input.current?.focus());
                },
            },
        );
    };

    if (!open) {
        return (
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="mt-1.5 flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted-fg transition-colors hover:bg-surface-2 hover:text-foreground"
            >
                <Plus className="size-4" />
                Adicionar item
            </button>
        );
    }

    return (
        <div className="mt-2 flex animate-pop items-center gap-2">
            <input
                ref={input}
                autoFocus
                value={content}
                placeholder="Novo item…"
                onChange={(event) => setContent(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') submit();
                    if (event.key === 'Escape') {
                        setOpen(false);
                        setContent('');
                    }
                }}
                className="min-w-0 flex-1 rounded-lg bg-surface-2 px-2.5 py-1.5 text-sm ring-1 ring-border focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <Button size="sm" onClick={submit}>
                Adicionar
            </Button>
            <button
                type="button"
                aria-label="Cancelar"
                onClick={() => {
                    setOpen(false);
                    setContent('');
                }}
                className="rounded p-1.5 text-muted-fg hover:text-foreground"
            >
                <X className="size-4" />
            </button>
        </div>
    );
}

function Comments({ card }: { card: CardDetail }) {
    const [body, setBody] = useState('');
    const [saving, setSaving] = useState(false);

    const submit = () => {
        const value = body.trim();

        if (!value) return;

        setSaving(true);
        router.post(
            `/cards/${card.id}/comments`,
            { body: value },
            { ...RELOAD, onSuccess: () => setBody(''), onFinish: () => setSaving(false) },
        );
    };

    return (
        <section>
            <SectionTitle icon={<MessageSquare className="size-4" />}>
                Comentários {card.comments.length > 0 && <span className="text-muted-fg">({card.comments.length})</span>}
            </SectionTitle>

            <div className="ml-9 mt-3 space-y-2">
                <textarea
                    rows={2}
                    value={body}
                    placeholder="Escrever um comentário… (Ctrl+Enter envia)"
                    onChange={(event) => setBody(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit();
                    }}
                    className="w-full resize-y rounded-lg bg-surface-2 p-3 text-sm ring-1 ring-border focus:outline-none focus:ring-2 focus:ring-primary"
                />

                {body.trim() && (
                    <Button size="sm" onClick={submit} loading={saving}>
                        Comentar
                    </Button>
                )}
            </div>

            <ul className="ml-9 mt-4 space-y-3">
                <AnimatePresence initial={false}>
                    {card.comments.map((comment) => (
                        <motion.li
                            key={comment.id}
                            layout
                            initial={{ opacity: 0, y: -8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, height: 0 }}
                            className="group flex gap-2.5"
                        >
                            <Avatar user={comment.author} size="sm" />

                            <div className="min-w-0 flex-1">
                                <p className="flex items-baseline gap-2">
                                    <span className="text-sm font-semibold">{comment.author.name}</span>
                                    <span className="text-[11px] text-muted-fg">
                                        {formatRelative(comment.created_at)}
                                    </span>
                                </p>
                                <p className="mt-1 whitespace-pre-wrap rounded-lg bg-surface-2 px-3 py-2 text-sm leading-relaxed">
                                    {comment.body}
                                </p>
                            </div>

                            {comment.can_delete && (
                                <button
                                    type="button"
                                    aria-label="Excluir comentário"
                                    onClick={() => router.delete(`/comments/${comment.id}`, RELOAD)}
                                    className="h-fit rounded p-1 text-muted-fg opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                                >
                                    <Trash2 className="size-3.5" />
                                </button>
                            )}
                        </motion.li>
                    ))}
                </AnimatePresence>
            </ul>
        </section>
    );
}
