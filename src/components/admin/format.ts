import { APP_LOCALE, APP_TIMEZONE } from '@/lib/timezone';

// Com ano, ao contrário do `formatDate` de lib/utils: a lista mistura contas de
// anos diferentes, e "14 de out." sozinho não diz se foi neste ano ou três
// atrás. No fuso do app, como toda data da tela — o mesmo texto no SSR e na
// hidratação.
const accountDate = new Intl.DateTimeFormat(APP_LOCALE, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: APP_TIMEZONE,
});

/** "14 de out. de 2026". */
export function formatAccountDate(iso: string): string {
    return accountDate.format(new Date(iso));
}

/** "1.234" — o separador de milhar dos cartões de estatística (useCountUp). */
export function formatCount(count: number): string {
    return count.toLocaleString(APP_LOCALE);
}

/** "1.234 cards". */
export function countLabel(count: number, singular: string, plural: string): string {
    return `${formatCount(count)} ${count === 1 ? singular : plural}`;
}

const HOUR = 60;
const DAY = 24 * HOUR;

/** "24 horas", "30 minutos", "3 dias": a validade de um link, lida de config.admin. */
export function durationLabel(minutes: number): string {
    if (minutes >= 2 * DAY && minutes % DAY === 0) return countLabel(minutes / DAY, 'dia', 'dias');
    if (minutes >= HOUR && minutes % HOUR === 0) return countLabel(minutes / HOUR, 'hora', 'horas');

    return countLabel(minutes, 'minuto', 'minutos');
}
