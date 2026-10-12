import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { APP_LOCALE, APP_TIMEZONE, dayKey, wallClock } from '@/lib/timezone';

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

/*
 * Toda data é formatada no fuso do APP (APP_TIMEZONE), não no do processo:
 * o servidor da Vercel roda em UTC, e o mesmo componente renderizado no SSR e
 * hidratado no navegador precisa produzir o mesmo texto — e concordar com o
 * servidor sobre o que é "hoje".
 */
const dateFormatter = new Intl.DateTimeFormat(APP_LOCALE, { day: '2-digit', month: 'short', timeZone: APP_TIMEZONE });
const dateTimeFormatter = new Intl.DateTimeFormat(APP_LOCALE, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: APP_TIMEZONE,
});
const relativeFormatter = new Intl.RelativeTimeFormat(APP_LOCALE, { numeric: 'auto' });

export function formatDate(iso: string | null | undefined): string {
    if (!iso) return '';

    return dateFormatter.format(new Date(iso));
}

export function formatDateTime(iso: string | null | undefined): string {
    if (!iso) return '';

    return dateTimeFormatter.format(new Date(iso));
}

/**
 * "há 3 horas", "ontem", "em 2 dias" — sem trazer uma lib de datas junto.
 *
 * Depende do relógio: renderize dentro de um elemento com
 * `suppressHydrationWarning` (ou use <TimeAgo />), porque o SSR e a hidratação
 * acontecem em instantes diferentes.
 */
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
 * O corte é a VIRADA DO DIA, não a hora marcada — o mesmo do servidor
 * (src/server/services/task-digest.ts). Um card para hoje às 10:00 segue "de
 * hoje" às 11:00; vira "vencido" só na virada da meia-noite, no fuso do app.
 *
 * Se as duas pontas divergirem, o selo vermelho do card contradiz o número do
 * painel na mesma tela.
 */
export function dueState(dueAt: string | null, completedAt: string | null, now: Date = new Date()): DueState {
    if (completedAt) return 'done';
    if (!dueAt) return 'none';

    const due = dayKey(dueAt);
    const today = dayKey(now);

    if (due < today) return 'overdue';
    if (due === today) return 'soon';

    return 'upcoming';
}

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * Converte "2026-08-12T10:00:00-03:00" no formato do <input type="datetime-local">,
 * no relógio do fuso do app — o mesmo em que o servidor interpreta o que volta.
 */
export function toDateTimeLocal(iso: string | null): string {
    if (!iso) return '';

    const date = new Date(iso);

    if (Number.isNaN(date.getTime())) return '';

    const wall = wallClock(date);

    return `${wall.year}-${pad(wall.month)}-${pad(wall.day)}T${pad(wall.hour)}:${pad(wall.minute)}`;
}

export function pluralize(count: number, singular: string, plural: string): string {
    return `${count} ${count === 1 ? singular : plural}`;
}
