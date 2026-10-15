import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compile } from 'tailwindcss';
import { describe, expect, it } from 'vitest';
import type { AdminFilter } from '@/types';
import { NoAccounts } from '@/components/admin/account-list';

/**
 * Regressão da revisão do painel /admin, na lista vazia
 * (src/components/admin/account-list.tsx).
 *
 * A dica repete o termo buscado, e a busca aceita até 100 caracteres
 * (MAX_SEARCH, em src/server/queries/admin.ts). Um termo sem espaço, como um
 * token ou um e-mail comprido colado no campo, é uma palavra só, e nada na
 * dica a quebrava: a 390 px a página rolava de lado (scrollWidth de 715 px com
 * 100 caracteres; por volta de 52 já passavam da tela).
 *
 * A dica é um item de grid com `place-items-center`, e a largura da trilha sai
 * do min-content dos itens. Por isso `break-words` (`overflow-wrap:
 * break-word`) não resolve: a palavra entra inteira no min-content e só quebra
 * depois, com a trilha já mais larga que a tela. `overflow-wrap: anywhere` (o
 * `wrap-anywhere`) e `word-break: break-all` entram no cálculo do min-content.
 *
 * Sem motor de layout aqui (BOAS_PRATICAS, 9.5), o teste confere o que decide
 * o resultado: o valor que o texto do termo herda, tirado do CSS que o
 * Tailwind do projeto gera para as classes de cada elemento em volta dele.
 * Conferir só o nome da classe não bastaria, porque o Tailwind ignora em
 * silêncio a classe que não conhece.
 */

/** 100 caracteres sem espaço (o teto da busca), como um token colado no campo. */
const TERM = 'k7Qx9Zp2Lm'.repeat(10);

/**
 * As classes de cada elemento aberto em volta do texto que contém `needle`, de
 * fora para dentro. O HTML do `renderToStaticMarkup` sai bem formado (elemento
 * vazio fecha com `/>`, e `<` e `>` vêm escapados), então uma expressão
 * regular por marca dá conta.
 */
function classesAround(html: string, needle: string): string[][] | null {
    const open: string[][] = [];

    for (const match of html.matchAll(/<(\/?)[a-zA-Z][\w-]*([^>]*?)(\/?)>|([^<]+)/g)) {
        const [, closing, attributes = '', selfClosing, text] = match as (string | undefined)[];

        if (text !== undefined) {
            if (text.includes(needle)) return open;
        } else if (closing) {
            open.pop();
        } else if (!selfClosing) {
            open.push(/\sclass="([^"]*)"/.exec(attributes)?.[1]?.split(/\s+/).filter(Boolean) ?? []);
        }
    }

    return null;
}

/**
 * O valor de `property` que o texto herda: o do elemento mais de dentro que a
 * declara. Um compilador novo por elemento, porque o `build` do Tailwind
 * acumula as classes das chamadas anteriores.
 */
async function inherited(chain: string[][], property: string): Promise<string | null> {
    for (const classes of [...chain].reverse()) {
        const css = (await compile('@tailwind utilities;')).build(classes);
        const value = new RegExp(`^\\s*${property}:\\s*([^;]+);`, 'm').exec(css)?.[1];

        if (value) return value;
    }

    return null;
}

describe('lista vazia do /admin: termo comprido sem espaço', () => {
    it.each<AdminFilter>(['all', 'admins', 'blocked'])(
        'a dica pode quebrar o termo no meio da palavra (filtro %s)',
        async (filter) => {
            const html = renderToStaticMarkup(createElement(NoAccounts, { filters: { q: TERM, filter }, navigate: () => {} }));
            const chain = classesAround(html, TERM);

            expect(chain, 'o termo buscado aparece inteiro na dica').not.toBeNull();

            const overflowWrap = await inherited(chain!, 'overflow-wrap');
            const wordBreak = await inherited(chain!, 'word-break');

            expect(
                overflowWrap === 'anywhere' || wordBreak === 'break-all',
                `o termo herda overflow-wrap: ${overflowWrap ?? 'normal'} e word-break: ${wordBreak ?? 'normal'}`,
            ).toBe(true);
        },
    );
});
