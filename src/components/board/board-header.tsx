'use client';

import { Archive, ClipboardList, History, ImageIcon, MoreHorizontal, Star, Trash2, UserPlus, X } from 'lucide-react';
import { useState } from 'react';
import { FilterPopover, type BoardFilters } from '@/components/board/filters';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Popover, PopoverItem } from '@/components/ui/popover';
import { runAction, useActionForm } from '@/lib/actions';
import { BOARD_BACKGROUND_LABEL, boardBackgroundClass } from '@/lib/palette';
import { cn } from '@/lib/utils';
import { addBoardMember, removeBoardMember, toggleFavorite, updateBoard } from '@/server/actions/boards';
import type { Board, BoardBackground } from '@/types';

interface BoardHeaderProps {
    board: Board;
    backgrounds: BoardBackground[];
    filters: BoardFilters;
    onFiltersChange: (filters: BoardFilters) => void;
    onToggleActivity: () => void;
    onStartExport: () => void;
    onOpenArchived: () => void;
    onDeleteBoard: () => void;
}

const ghost =
    'inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-white ' +
    'bg-white/15 ring-1 ring-white/20 transition-all duration-150 hover:bg-white/25 active:scale-95';

/**
 * O campo do título só aparece porque a pessoa clicou para renomear, então o
 * foco vai junto — no commit, como o `autoFocus` faria.
 */
const focusOnMount = (node: HTMLInputElement | null) => node?.focus();

export function BoardHeader({
    board,
    backgrounds,
    filters,
    onFiltersChange,
    onToggleActivity,
    onStartExport,
    onOpenArchived,
    onDeleteBoard,
}: BoardHeaderProps) {
    const [editing, setEditing] = useState(false);
    const [title, setTitle] = useState(board.title);

    // O rascunho parte sempre do título atual — outro membro pode ter
    // renomeado o quadro desde a última edição.
    const startEditing = () => {
        setTitle(board.title);
        setEditing(true);
    };

    const saveTitle = () => {
        const value = title.trim();

        setEditing(false);

        if (!value || value === board.title) {
            setTitle(board.title);

            return;
        }

        void runAction(updateBoard({ boardId: board.id, title: value }));
    };

    return (
        <div className="flex items-center gap-2">
            {editing ? (
                <input
                    ref={focusOnMount}
                    value={title}
                    maxLength={120}
                    aria-label="Nome do quadro"
                    onChange={(event) => setTitle(event.target.value)}
                    onBlur={saveTitle}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') saveTitle();
                        if (event.key === 'Escape') {
                            setTitle(board.title);
                            setEditing(false);
                        }
                    }}
                    // min-w-0: no celular o campo encolhe em vez de empurrar as
                    // ações para baixo do cronômetro.
                    className="w-56 min-w-0 rounded-lg bg-white/95 px-2.5 py-1.5 text-base font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-white"
                />
            ) : (
                <button
                    type="button"
                    onClick={() => board.can.manage && startEditing()}
                    className={cn(
                        'max-w-[16rem] truncate rounded-lg px-2.5 py-1.5 text-base font-bold text-white drop-shadow',
                        board.can.manage && 'transition-colors hover:bg-white/15',
                    )}
                >
                    {board.title}
                </button>
            )}

            <button
                type="button"
                aria-label={board.is_favorite ? 'Remover dos favoritos' : 'Favoritar quadro'}
                onClick={() => void runAction(toggleFavorite({ boardId: board.id }))}
                className={cn(
                    'rounded-lg p-2 transition-all duration-200 hover:bg-white/15 active:scale-90',
                    board.is_favorite ? 'text-amber-300' : 'text-white/70',
                )}
            >
                <Star className={cn('size-4.5', board.is_favorite && 'fill-current')} />
            </button>

            <div className="ml-1 hidden items-center gap-2 sm:flex">
                <div className="flex -space-x-2">
                    {board.members.slice(0, 5).map((member) => (
                        <Avatar key={member.id} user={member} size="sm" ring />
                    ))}
                </div>

                {board.can.manage && <InvitePopover board={board} />}
            </div>

            <div className="ml-auto flex items-center gap-2">
                <FilterPopover board={board} filters={filters} onChange={onFiltersChange} />

                <button type="button" onClick={onStartExport} className={cn(ghost, 'hidden lg:inline-flex')}>
                    <ClipboardList className="size-4" />
                    Exportar
                </button>

                {/* A partir de `lg`, como o Exportar: no tablet o cabeçalho não
                    comporta o botão, e "Ver atividade" está no menu "…". */}
                <button type="button" onClick={onToggleActivity} className={cn(ghost, 'hidden lg:inline-flex')}>
                    <History className="size-4" />
                    Atividade
                </button>

                {/* Abaixo de `sm` a paleta de fundo vai para o menu "…" (como
                    Exportar e Atividade, que também se recolhem nele quando
                    falta largura): a linha do cabeçalho não comporta o botão. */}
                {board.can.manage && (
                    <div className="hidden sm:contents">
                        <BackgroundPopover board={board} backgrounds={backgrounds} />
                    </div>
                )}

                <Popover
                    align="right"
                    className="w-56"
                    trigger={({ toggle }) => (
                        <button type="button" onClick={toggle} aria-label="Menu do quadro" className={cn(ghost, 'px-2.5')}>
                            <MoreHorizontal className="size-4" />
                        </button>
                    )}
                >
                    {({ close }) => (
                        <>
                            <PopoverItem
                                icon={<ClipboardList className="size-4" />}
                                onClick={() => {
                                    close();
                                    onStartExport();
                                }}
                            >
                                Exportar como prompt
                            </PopoverItem>

                            <PopoverItem
                                icon={<History className="size-4" />}
                                onClick={() => {
                                    close();
                                    onToggleActivity();
                                }}
                            >
                                Ver atividade
                            </PopoverItem>

                            {/* Aparece sempre, mesmo com a gaveta vazia: é por
                                aqui que se liga o arquivamento automático, e
                                esconder a entrada esconderia o recurso inteiro. */}
                            <PopoverItem
                                icon={<Archive className="size-4" />}
                                onClick={() => {
                                    close();
                                    onOpenArchived();
                                }}
                            >
                                <span className="flex-1">Arquivados</span>
                                {board.archived_count > 0 && (
                                    <span className="rounded-full bg-surface-2 px-1.5 text-[10px] font-bold tabular-nums text-muted-fg">
                                        {board.archived_count}
                                    </span>
                                )}
                            </PopoverItem>

                            {/* Só no celular: o botão de fundo do cabeçalho some
                                abaixo de `sm` e a paleta mora aqui. */}
                            {board.can.manage && (
                                <div className="sm:hidden">
                                    <div className="my-1 h-px bg-border" />
                                    <p className="px-2.5 pb-0.5 pt-1.5 text-xs font-semibold uppercase tracking-wide text-muted-fg">
                                        Fundo do quadro
                                    </p>
                                    <BackgroundGrid board={board} backgrounds={backgrounds} />
                                </div>
                            )}

                            {board.can.delete && (
                                <>
                                    <div className="my-1 h-px bg-border" />
                                    <PopoverItem
                                        danger
                                        icon={<Trash2 className="size-4" />}
                                        onClick={() => {
                                            close();
                                            onDeleteBoard();
                                        }}
                                    >
                                        Excluir quadro
                                    </PopoverItem>
                                </>
                            )}
                        </>
                    )}
                </Popover>
            </div>
        </div>
    );
}

function BackgroundPopover({ board, backgrounds }: { board: Board; backgrounds: BoardBackground[] }) {
    return (
        <Popover
            align="right"
            className="w-64"
            title="Fundo do quadro"
            trigger={({ toggle }) => (
                <button type="button" onClick={toggle} aria-label="Trocar fundo" className={cn(ghost, 'px-2.5')}>
                    <ImageIcon className="size-4" />
                </button>
            )}
        >
            {() => <BackgroundGrid board={board} backgrounds={backgrounds} />}
        </Popover>
    );
}

/** A paleta de fundos — no popover do cabeçalho e, no celular, no menu "…". */
function BackgroundGrid({ board, backgrounds }: { board: Board; backgrounds: BoardBackground[] }) {
    return (
        <div className="grid grid-cols-4 gap-2 p-1.5">
            {backgrounds.map((background) => (
                <button
                    key={background}
                    type="button"
                    title={BOARD_BACKGROUND_LABEL[background]}
                    aria-label={BOARD_BACKGROUND_LABEL[background]}
                    aria-pressed={board.background === background}
                    onClick={() => void runAction(updateBoard({ boardId: board.id, background }))}
                    className={cn(
                        'h-11 rounded-lg transition-transform duration-150 hover:scale-105 active:scale-95',
                        boardBackgroundClass(background),
                        board.background === background &&
                            'ring-2 ring-primary ring-offset-2 ring-offset-[var(--surface)]',
                    )}
                />
            ))}
        </div>
    );
}

function InvitePopover({ board }: { board: Board }) {
    const form = useActionForm({ email: '', role: 'member' as 'member' | 'admin' }, (data) =>
        addBoardMember({ boardId: board.id, ...data }),
    );

    return (
        <Popover
            // Abaixo de `md` o botão fica perto da borda direita e o painel de
            // 20rem, aberto para a direita, sairia da tela: ali ele abre para
            // a esquerda.
            className="w-80 max-md:left-auto max-md:right-0"
            title="Convidar para o quadro"
            trigger={({ toggle }) => (
                <button
                    type="button"
                    onClick={toggle}
                    aria-label="Convidar pessoa"
                    className="grid size-7 place-items-center rounded-full bg-white/20 text-white ring-2 ring-white/40 transition-transform duration-200 hover:scale-110 active:scale-95"
                >
                    <UserPlus className="size-3.5" />
                </button>
            )}
        >
            {() => (
                <div className="space-y-3 p-2">
                    <form
                        onSubmit={(event) => {
                            event.preventDefault();
                            void form.submit({ onSuccess: () => form.reset() });
                        }}
                        className="space-y-2"
                    >
                        <Field error={form.errors.email}>
                            <Input
                                type="email"
                                required
                                aria-label="E-mail da pessoa"
                                placeholder="email@da.pessoa"
                                value={form.data.email}
                                onChange={(event) => form.setData('email', event.target.value)}
                            />
                        </Field>

                        <div className="flex gap-2">
                            <select
                                value={form.data.role}
                                aria-label="Papel no quadro"
                                onChange={(event) => form.setData('role', event.target.value as 'member' | 'admin')}
                                className="rounded-lg bg-surface-2 px-2.5 text-sm ring-1 ring-border focus:outline-none focus:ring-2 focus:ring-primary"
                            >
                                <option value="member">Membro</option>
                                <option value="admin">Admin</option>
                            </select>

                            <Button type="submit" size="sm" className="flex-1" loading={form.processing}>
                                Convidar
                            </Button>
                        </div>
                    </form>

                    <div className="space-y-1 border-t border-border pt-2">
                        {board.members.map((member) => (
                            <div key={member.id} className="flex items-center gap-2.5 rounded-lg px-1 py-1.5">
                                <Avatar user={member} size="sm" />

                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium">{member.name}</p>
                                    <p className="truncate text-[11px] text-muted-fg">
                                        {member.role === 'owner' ? 'Dono' : member.role === 'admin' ? 'Admin' : 'Membro'}
                                    </p>
                                </div>

                                {member.id !== board.owner_id && (
                                    <button
                                        type="button"
                                        aria-label={`Remover ${member.name}`}
                                        onClick={() =>
                                            void runAction(removeBoardMember({ boardId: board.id, userId: member.id }))
                                        }
                                        className="rounded-md p-1 text-muted-fg transition-colors hover:bg-danger/10 hover:text-danger"
                                    >
                                        <X className="size-3.5" />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </Popover>
    );
}
