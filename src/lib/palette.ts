import type { AvatarColor, BoardBackground, ColorKey } from '@/types';

/**
 * O Tailwind só gera a classe que enxerga escrita por extenso no código, então
 * cores dinâmicas viram um mapa estático de chave → classes.
 * As chaves espelham BACKGROUNDS, COLORS e AVATAR_COLORS de src/server/config.ts.
 */

export const COLOR_KEYS: ColorKey[] = [
    'emerald',
    'amber',
    'orange',
    'rose',
    'violet',
    'blue',
    'sky',
    'lime',
    'pink',
    'slate',
];

/** Bloco sólido — usado em capas de card e nos seletores de cor. */
export const COLOR_SOLID: Record<ColorKey, string> = {
    emerald: 'bg-emerald-500',
    amber: 'bg-amber-500',
    orange: 'bg-orange-500',
    rose: 'bg-rose-500',
    violet: 'bg-violet-500',
    blue: 'bg-blue-500',
    sky: 'bg-sky-500',
    lime: 'bg-lime-500',
    pink: 'bg-pink-500',
    slate: 'bg-slate-500',
};

/** Etiqueta com texto — fundo suave, texto legível nos dois temas. */
export const COLOR_CHIP: Record<ColorKey, string> = {
    emerald: 'bg-emerald-500/15 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300',
    amber: 'bg-amber-500/15 text-amber-700 ring-amber-500/25 dark:text-amber-300',
    orange: 'bg-orange-500/15 text-orange-700 ring-orange-500/25 dark:text-orange-300',
    rose: 'bg-rose-500/15 text-rose-700 ring-rose-500/25 dark:text-rose-300',
    violet: 'bg-violet-500/15 text-violet-700 ring-violet-500/25 dark:text-violet-300',
    blue: 'bg-blue-500/15 text-blue-700 ring-blue-500/25 dark:text-blue-300',
    sky: 'bg-sky-500/15 text-sky-700 ring-sky-500/25 dark:text-sky-300',
    lime: 'bg-lime-500/15 text-lime-700 ring-lime-500/25 dark:text-lime-300',
    pink: 'bg-pink-500/15 text-pink-700 ring-pink-500/25 dark:text-pink-300',
    slate: 'bg-slate-500/15 text-slate-700 ring-slate-500/25 dark:text-slate-300',
};

export const AVATAR_COLOR: Record<AvatarColor, string> = {
    violet: 'bg-gradient-to-br from-violet-500 to-purple-600 text-white',
    blue: 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white',
    emerald: 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white',
    amber: 'bg-gradient-to-br from-amber-400 to-orange-500 text-white',
    rose: 'bg-gradient-to-br from-rose-500 to-pink-600 text-white',
    cyan: 'bg-gradient-to-br from-cyan-400 to-sky-600 text-white',
    fuchsia: 'bg-gradient-to-br from-fuchsia-500 to-purple-600 text-white',
    teal: 'bg-gradient-to-br from-teal-400 to-emerald-600 text-white',
};

export const BOARD_BACKGROUND: Record<BoardBackground, string> = {
    aurora: 'board-bg board-bg-aurora',
    sunset: 'board-bg board-bg-sunset',
    ocean: 'board-bg board-bg-ocean',
    forest: 'board-bg board-bg-forest',
    candy: 'board-bg board-bg-candy',
    midnight: 'board-bg board-bg-midnight',
    ember: 'board-bg board-bg-ember',
    graphite: 'board-bg board-bg-graphite',
};

export const BOARD_BACKGROUND_LABEL: Record<BoardBackground, string> = {
    aurora: 'Aurora',
    sunset: 'Pôr do sol',
    ocean: 'Oceano',
    forest: 'Floresta',
    candy: 'Algodão-doce',
    midnight: 'Meia-noite',
    ember: 'Brasa',
    graphite: 'Grafite',
};

export function boardBackgroundClass(key: string): string {
    return BOARD_BACKGROUND[key as BoardBackground] ?? BOARD_BACKGROUND.aurora;
}

export function avatarColorClass(key: string | null | undefined): string {
    return AVATAR_COLOR[(key ?? 'violet') as AvatarColor] ?? AVATAR_COLOR.violet;
}
