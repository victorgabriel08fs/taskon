'use client';

import { Check, Filter, X } from 'lucide-react';
import { useId } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Popover } from '@/components/ui/popover';
import { COLOR_CHIP } from '@/lib/palette';
import { cn } from '@/lib/utils';
import type { Board, Card } from '@/types';

export interface BoardFilters {
    query: string;
    labelIds: number[];
    memberIds: number[];
    onlyMine: boolean;
    hideDone: boolean;
}

export const EMPTY_FILTERS: BoardFilters = {
    query: '',
    labelIds: [],
    memberIds: [],
    onlyMine: false,
    hideDone: false,
};

export function countActiveFilters(filters: BoardFilters): number {
    return (
        (filters.query ? 1 : 0) +
        filters.labelIds.length +
        filters.memberIds.length +
        (filters.onlyMine ? 1 : 0) +
        (filters.hideDone ? 1 : 0)
    );
}

export function matchesFilters(card: Card, filters: BoardFilters, currentUserId: number): boolean {
    if (filters.query && !card.title.toLowerCase().includes(filters.query.toLowerCase())) return false;
    if (filters.hideDone && card.completed_at) return false;
    if (filters.onlyMine && !card.member_ids.includes(currentUserId)) return false;
    if (filters.labelIds.length && !filters.labelIds.some((id) => card.label_ids.includes(id))) return false;
    if (filters.memberIds.length && !filters.memberIds.some((id) => card.member_ids.includes(id))) return false;

    return true;
}

function toggle(list: number[], value: number): number[] {
    return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export function FilterPopover({
    board,
    filters,
    onChange,
}: {
    board: Board;
    filters: BoardFilters;
    onChange: (filters: BoardFilters) => void;
}) {
    const active = countActiveFilters(filters);
    const searchId = useId();

    return (
        <Popover
            align="right"
            className="w-80"
            trigger={({ toggle: openToggle }) => (
                <button
                    type="button"
                    onClick={openToggle}
                    className={cn(
                        'inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-all duration-150',
                        'bg-white/15 text-white ring-1 ring-white/20 hover:bg-white/25 active:scale-95',
                        active > 0 && 'bg-white/90 text-violet-700 ring-white',
                    )}
                >
                    <Filter className="size-4" />
                    Filtros
                    {active > 0 && (
                        <span className="rounded-full bg-violet-600 px-1.5 text-[10px] font-bold text-white">
                            {active}
                        </span>
                    )}
                </button>
            )}
        >
            {() => (
                <div className="space-y-4 p-2">
                    <div>
                        <label
                            htmlFor={searchId}
                            className="text-xs font-semibold uppercase tracking-wide text-muted-fg"
                        >
                            Buscar
                        </label>
                        <div className="relative mt-1.5">
                            <input
                                id={searchId}
                                value={filters.query}
                                onChange={(event) => onChange({ ...filters, query: event.target.value })}
                                placeholder="Título do card…"
                                className="w-full rounded-lg bg-surface-2 px-3 py-2 pr-8 text-sm ring-1 ring-border focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                            {filters.query && (
                                <button
                                    type="button"
                                    aria-label="Limpar busca"
                                    onClick={() => onChange({ ...filters, query: '' })}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-fg hover:text-foreground"
                                >
                                    <X className="size-4" />
                                </button>
                            )}
                        </div>
                    </div>

                    {board.labels.length > 0 && (
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-fg">Etiquetas</p>
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                                {board.labels.map((label) => (
                                    <button
                                        key={label.id}
                                        type="button"
                                        aria-pressed={filters.labelIds.includes(label.id)}
                                        onClick={() => onChange({ ...filters, labelIds: toggle(filters.labelIds, label.id) })}
                                        className={cn(
                                            'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ring-1 transition-transform duration-150 hover:scale-105 active:scale-95',
                                            COLOR_CHIP[label.color],
                                            filters.labelIds.includes(label.id) && 'ring-2 ring-primary',
                                        )}
                                    >
                                        {filters.labelIds.includes(label.id) && <Check className="size-3" />}
                                        {label.name || 'Sem nome'}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-fg">Membros</p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {board.members.map((member) => (
                                <button
                                    key={member.id}
                                    type="button"
                                    aria-label={member.name}
                                    aria-pressed={filters.memberIds.includes(member.id)}
                                    onClick={() => onChange({ ...filters, memberIds: toggle(filters.memberIds, member.id) })}
                                    className={cn(
                                        'rounded-full transition-transform duration-150 hover:scale-110 active:scale-95',
                                        filters.memberIds.includes(member.id) &&
                                            'ring-2 ring-primary ring-offset-2 ring-offset-[var(--surface)]',
                                    )}
                                >
                                    <Avatar user={member} size="sm" />
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-2 border-t border-border pt-3">
                        <FilterSwitch
                            label="Só os meus cards"
                            checked={filters.onlyMine}
                            onChange={(value) => onChange({ ...filters, onlyMine: value })}
                        />
                        <FilterSwitch
                            label="Esconder concluídos"
                            checked={filters.hideDone}
                            onChange={(value) => onChange({ ...filters, hideDone: value })}
                        />
                    </div>

                    {active > 0 && (
                        <button
                            type="button"
                            onClick={() => onChange(EMPTY_FILTERS)}
                            className="w-full rounded-lg bg-surface-2 py-2 text-sm font-medium text-muted-fg transition-colors hover:bg-surface-3 hover:text-foreground"
                        >
                            Limpar filtros
                        </button>
                    )}
                </div>
            )}
        </Popover>
    );
}

/**
 * Linha inteira clicável com o interruptor à direita. Não é o `Switch` de
 * `ui/`: aqui o rótulo faz parte do botão, e o tamanho acompanha a lista.
 */
function FilterSwitch({
    label,
    checked,
    onChange,
}: {
    label: string;
    checked: boolean;
    onChange: (value: boolean) => void;
}) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            onClick={() => onChange(!checked)}
            className="flex w-full items-center justify-between rounded-lg px-1 py-1 text-sm transition-colors hover:bg-surface-2"
        >
            <span>{label}</span>
            <span
                className={cn(
                    'relative h-5 w-9 rounded-full transition-colors duration-200',
                    checked ? 'bg-primary' : 'bg-surface-3',
                )}
            >
                <span
                    className={cn(
                        'absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform duration-200',
                        checked ? 'translate-x-4.5' : 'translate-x-0.5',
                    )}
                />
            </span>
        </button>
    );
}
