/**
 * Iniciais do avatar — o accessor `initials` do model User do Laravel:
 * nenhuma palavra → "?"; uma → as duas primeiras letras; várias → primeira
 * letra da primeira e da última. Conta caracteres, não unidades UTF-16.
 */
export function initialsOf(name: string | null | undefined): string {
    const words = (name ?? '').trim().split(/\s+/u).filter(Boolean);

    if (words.length === 0) return '?';

    if (words.length === 1) return [...words[0]].slice(0, 2).join('').toLocaleUpperCase('pt-BR');

    const first = [...words[0]][0] ?? '';
    const last = [...words[words.length - 1]][0] ?? '';

    return (first + last).toLocaleUpperCase('pt-BR');
}
