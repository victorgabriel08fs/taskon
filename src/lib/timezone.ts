/**
 * O fuso do app — o mesmo dos dois lados da rede.
 *
 * No Laravel ele morava em `config/app.php` e o PHP fazia tudo nele. Aqui o
 * servidor roda em UTC (Vercel) e o navegador no fuso de quem abre, então o
 * fuso precisa ser explícito em TODA conta de "hoje" e em toda data formatada.
 * Se servidor e navegador decidirem "hoje" em fusos diferentes, o selo vermelho
 * do card contradiz o número do painel — e o HTML do SSR não bate com a
 * hidratação.
 *
 * `NEXT_PUBLIC_APP_TIMEZONE` é preenchido pelo next.config.ts a partir de
 * `APP_TIMEZONE`, para chegar ao bundle do navegador. Scripts e testes (que
 * não passam pelo Next) leem `APP_TIMEZONE` direto.
 */
export const APP_TIMEZONE: string =
    process.env.NEXT_PUBLIC_APP_TIMEZONE || process.env.APP_TIMEZONE || 'America/Sao_Paulo';

export const APP_LOCALE = 'pt-BR';

const dayKeyFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

/** "2026-10-12" — o dia do calendário em que o instante cai, no fuso do app. */
export function dayKey(date: Date | string | number): string {
    return dayKeyFormatter.format(new Date(date));
}

const partsFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIMEZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
});

/** As partes de relógio de parede do instante, no fuso do app. */
export function wallClock(date: Date | string | number): {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
} {
    const parts = Object.fromEntries(
        partsFormatter.formatToParts(new Date(date)).map((part) => [part.type, part.value]),
    ) as Record<string, string>;

    return {
        year: Number(parts.year),
        month: Number(parts.month),
        day: Number(parts.day),
        hour: Number(parts.hour) % 24,
        minute: Number(parts.minute),
        second: Number(parts.second),
    };
}

/** Diferença (ms) entre o relógio de parede do fuso e o UTC naquele instante. */
function offsetMs(instant: number): number {
    const wall = wallClock(instant);
    const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);

    return asUtc - (instant - (instant % 1000));
}

/**
 * Converte um horário de parede no fuso do app ("2026-10-12T14:30", o formato
 * do `<input type="datetime-local">`) no instante correspondente.
 *
 * É o que o Laravel fazia ao receber uma data sem fuso: interpretá-la no fuso
 * do app. Duas passadas acertam a hora até perto das viradas de horário de
 * verão.
 */
export function fromWallClock(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): Date {
    const guess = Date.UTC(year, month - 1, day, hour, minute, second);
    let instant = guess - offsetMs(guess);

    instant = guess - offsetMs(instant);

    return new Date(instant);
}

/**
 * Lê uma data vinda de formulário. Aceita ISO com fuso (usa o instante como
 * veio) ou sem fuso (interpreta no fuso do app). Devolve `null` se não for
 * uma data.
 */
export function parseAppDateTime(value: string): Date | null {
    const trimmed = value.trim();

    if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
        const date = new Date(trimmed);

        return Number.isNaN(date.getTime()) ? null : date;
    }

    const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/.exec(trimmed);

    if (!match) return null;

    const [, y, mo, d, h = '0', mi = '0', s = '0'] = match;
    const date = fromWallClock(Number(y), Number(mo), Number(d), Number(h), Number(mi), Number(s));

    if (Number.isNaN(date.getTime())) return null;

    // 2026-02-31 viraria 03-03 em silêncio; o `date` do Laravel recusava.
    const wall = wallClock(date);

    if (wall.year !== Number(y) || wall.month !== Number(mo) || wall.day !== Number(d)) return null;

    return date;
}

/** Meia-noite (00:00:00.000) do dia do instante, no fuso do app. */
export function startOfAppDay(date: Date | string | number): Date {
    const wall = wallClock(date);

    return fromWallClock(wall.year, wall.month, wall.day);
}

/** 23:59:59.999 do dia do instante, no fuso do app — o `endOfDay()` do Carbon. */
export function endOfAppDay(date: Date | string | number): Date {
    const wall = wallClock(date);
    const nextMidnight = fromWallClock(wall.year, wall.month, wall.day + 1);

    return new Date(nextMidnight.getTime() - 1);
}

/** Soma dias de CALENDÁRIO no fuso do app, mantendo a hora de parede. */
export function addAppDays(date: Date | string | number, days: number): Date {
    const wall = wallClock(date);
    const ms = new Date(date).getMilliseconds();
    const shifted = fromWallClock(wall.year, wall.month, wall.day + days, wall.hour, wall.minute, wall.second);

    return new Date(shifted.getTime() + ms);
}

const pad = (value: number, size = 2) => String(value).padStart(size, '0');

/**
 * ISO 8601 com o deslocamento do fuso do app — "2026-10-12T14:30:00-03:00".
 * É o formato do `toIso8601String()` do Carbon, que o frontend e os textos
 * exportados já esperavam.
 */
export function toAppIso(date: Date | string | number | null | undefined): string | null {
    if (date === null || date === undefined) return null;

    const instant = new Date(date);

    if (Number.isNaN(instant.getTime())) return null;

    const wall = wallClock(instant);
    const offsetMinutes = Math.round(offsetMs(instant.getTime()) / 60_000);
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const abs = Math.abs(offsetMinutes);

    return (
        `${wall.year}-${pad(wall.month)}-${pad(wall.day)}T${pad(wall.hour)}:${pad(wall.minute)}:${pad(wall.second)}` +
        `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
    );
}
