/**
 * Ids que chegam pelo caminho da URL (`/boards/[boardId]`,
 * `/boards/[boardId]/cards/[cardId]`).
 *
 * O segmento é texto livre, e nem todo número é um id possível: as chaves
 * são `integer` do Postgres, e um id acima do teto mandado ao banco derruba a
 * consulta ("value out of range for type integer") — a página respondia 500
 * onde o certo é 404, como para qualquer id que não existe.
 */

/**
 * Teto do `integer` do Postgres (2³¹ − 1). É o mesmo `MAX_ID` de
 * src/server/validation.ts, repetido de propósito: `src/lib` também vai para o
 * navegador e não importa código de servidor (nem o zod que viria junto).
 */
export const MAX_ROUTE_ID = 2_147_483_647;

/** O id do segmento da URL, ou null quando ele não pode existir (a página responde 404). */
export function parseRouteId(value: string): number | null {
    // Só dígitos: o Number() sozinho aceitaria "1e3", "0x10", " 7" e até "" (0).
    if (!/^\d+$/.test(value)) return null;

    const id = Number(value);

    return id > 0 && id <= MAX_ROUTE_ID ? id : null;
}
