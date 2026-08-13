import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });
const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
});
const relativeFormatter = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });

export function formatDate(iso: string | null | undefined): string {
    if (!iso) return '';

    return dateFormatter.format(new Date(iso));
}

export function formatDateTime(iso: string | null | undefined): string {
    if (!iso) return '';

    return dateTimeFormatter.format(new Date(iso));
}

/** "há 3 horas", "ontem", "em 2 dias" — sem trazer uma lib de datas junto. */
export function formatRelative(iso: string | null | undefined): string {
    if (!iso) return '';

    const diff = new Date(iso).getTime() - Date.now();
    const units: [Intl.RelativeTimeFormatUnit, number][] = [
        ['year', 31_536_000_000],
        ['month', 2_592_000_000],
        ['day', 86_400_000],
        ['hour', 3_600_000],
        ['minute', 60_000],
    ];

    for (const [unit, ms] of units) {
        if (Math.abs(diff) >= ms) {
            return relativeFormatter.format(Math.round(diff / ms), unit);
        }
    }

    return 'agora';
}

export type DueState = 'none' | 'upcoming' | 'soon' | 'overdue' | 'done';

/**
 * O corte é a VIRADA DO DIA, não a hora marcada — o mesmo do backend
 * (App\Support\TaskDigest). Um card para hoje às 10:00 segue "de hoje" às
 * 11:00; vira "vencido" só na virada da meia-noite.
 *
 * Se as duas pontas divergirem, o selo vermelho do card contradiz o número do
 * painel na mesma tela.
 */
export function dueState(dueAt: string | null, completedAt: string | null): DueState {
    if (completedAt) return 'done';
    if (!dueAt) return 'none';

    const due = new Date(dueAt);

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    if (due < startOfToday) return 'overdue';

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    if (due <= endOfToday) return 'soon';

    return 'upcoming';
}

/** Converte "2026-08-12T10:00:00-03:00" no formato aceito por <input type="datetime-local">. */
export function toDateTimeLocal(iso: string | null): string {
    if (!iso) return '';

    const date = new Date(iso);
    const offset = date.getTimezoneOffset() * 60_000;

    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function pluralize(count: number, singular: string, plural: string): string {
    return `${count} ${count === 1 ? singular : plural}`;
}
