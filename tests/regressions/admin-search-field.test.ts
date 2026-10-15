import { describe, expect, it } from 'vitest';
import {
    hasSearch,
    initialSearchField,
    searchFieldReducer,
    type SearchField,
    type SearchFieldEvent,
} from '@/components/admin/account-toolbar';

/**
 * Regressão da busca do painel /admin (src/components/admin/account-toolbar.tsx).
 *
 * O campo marcava a busca como vista já no envio, mas a prop `filters.q` só
 * muda quando a navegação do router.push faz commit (a transição espera a
 * resposta do servidor). O render seguinte, ainda com a prop velha, via a
 * diferença e devolvia o campo ao termo anterior:
 *
 *  1. Enter em "ana": o campo ficava vazio, e o X sumia, durante toda a espera;
 *  2. o X numa busca ativa: o campo seguia com o termo até a resposta chegar;
 *  3. o que se digitava na espera era sobrescrito quando a resposta chegava.
 *
 * E, com o termo enfim mantido na espera, o X dessa hora só esvaziava o campo:
 * a busca pendente chegava e filtrava a lista com o campo vazio.
 *
 * As transições são puras: aqui os eventos são aplicados na ordem em que o
 * React os veria. Cada render confere a busca da URL (`render`), e a prop só
 * troca quando a resposta chega. O roteador do Next fica com a ÚLTIMA
 * navegação: uma navegação passada para trás nunca faz commit.
 */

function run(field: SearchField, ...events: SearchFieldEvent[]): SearchField {
    return events.reduce(searchFieldReducer, field);
}

/** Um render do SearchForm com a busca da URL que a página tem agora. */
function render(field: SearchField, urlQ: string): SearchField {
    return searchFieldReducer(field, { type: 'url', q: urlQ });
}

const typed = (query: string): SearchFieldEvent => ({ type: 'input', query });
const asked = (q: string): SearchFieldEvent => ({ type: 'ask', q });

describe('busca do painel: o campo durante a espera', () => {
    it('Enter mantém o termo no campo enquanto a resposta não chega', () => {
        const sent = run(initialSearchField(''), typed('ana'), asked('ana'));

        // O render logo depois do Enter ainda traz a URL sem busca.
        const waiting = render(render(sent, ''), '');

        expect(waiting.query).toBe('ana');

        const arrived = render(waiting, 'ana');

        expect(arrived).toEqual({ query: 'ana', seen: 'ana', asked: null });
    });

    it('o X numa busca ativa esvazia o campo na hora, e a resposta não o enche de novo', () => {
        const start = initialSearchField('ana');

        expect(hasSearch(start)).toBe(true);

        const waiting = render(run(start, asked('')), 'ana');

        expect(waiting.query).toBe('');

        expect(render(waiting, '')).toEqual({ query: '', seen: '', asked: null });
    });

    it('o que se digita na espera sobrevive à resposta', () => {
        const sent = render(run(initialSearchField(''), typed('ana'), asked('ana')), '');
        const typing = render(run(sent, typed('b'), typed('beatriz')), '');

        const arrived = render(typing, 'ana');

        expect(arrived.query).toBe('beatriz');
        expect(arrived.seen).toBe('ana');
        expect(arrived.asked).toBeNull();
    });

    it('Enter de novo na espera termina no último termo', () => {
        const first = render(run(initialSearchField(''), typed('ana'), asked('ana')), '');
        const second = render(run(first, typed('bia'), asked('bia')), '');

        // A navegação de "ana" foi descartada pelo roteador: só "bia" chega.
        expect(render(second, 'bia')).toEqual({ query: 'bia', seen: 'bia', asked: null });
    });

    it('o X durante uma busca pendente também a cancela', () => {
        const pending = render(run(initialSearchField(''), typed('ana'), asked('ana')), '');

        // A URL ainda não tem busca, mas há uma a caminho: o X navega.
        expect(hasSearch(pending)).toBe(true);

        // A navegação para /admin passa na frente da de "ana", que nunca chega.
        const cleared = render(run(pending, asked('')), '');

        expect(cleared.query).toBe('');
        expect(hasSearch(cleared)).toBe(false);
    });

    it('sem busca na URL nem a caminho, o X só esvazia o campo', () => {
        const draft = run(initialSearchField(''), typed('rascunho'));

        expect(hasSearch(draft)).toBe(false);
    });
});

describe('busca do painel: o que a URL muda por fora', () => {
    it('Voltar e "Ver todas as contas" levam o campo junto, mesmo com texto não enviado', () => {
        const draft = run(initialSearchField('ana'), typed('ana b'));

        expect(render(draft, '')).toEqual({ query: '', seen: '', asked: null });
        expect(render(draft, 'zé')).toEqual({ query: 'zé', seen: 'zé', asked: null });
    });

    it('Voltar durante uma busca pendente vence o pedido do campo', () => {
        const pending = render(run(initialSearchField('ana'), typed('bia'), asked('bia')), 'ana');

        // O Voltar descarta a navegação de "bia" e restaura "zé".
        expect(render(pending, 'zé')).toEqual({ query: 'zé', seen: 'zé', asked: null });
    });

    it('trocar o filtro (a busca da URL igual) não mexe no texto não enviado', () => {
        const draft = run(initialSearchField('ana'), typed('beat'));

        expect(render(draft, 'ana')).toBe(draft);
    });

    it('um render sem mudança na URL devolve o mesmo estado (o ajuste no render não entra em laço)', () => {
        const field = render(run(initialSearchField(''), asked('ana')), 'ana');

        expect(render(field, field.seen)).toBe(field);
    });
});
