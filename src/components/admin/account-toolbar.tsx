'use client';

import { Search, X } from 'lucide-react';
import Link from 'next/link';
import { useOptimistic, useReducer, useRef } from 'react';
import { ADMIN_FILTERS, adminHref, type Navigate } from '@/components/admin/admin-links';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { AdminPanelData } from '@/types';

type Filters = AdminPanelData['filters'];

/** Busca por nome ou e-mail e o filtro Todos/Admins/Bloqueados — os dois pela URL. */
export function AccountToolbar({ filters, navigate }: { filters: Filters; navigate: Navigate }) {
    return (
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <SearchForm filters={filters} navigate={navigate} />
            <FilterTabs filters={filters} navigate={navigate} />
        </div>
    );
}

/**
 * O campo de busca diante da URL, em transições puras (testadas em
 * tests/regressions/admin-search-field.test.ts).
 *
 * A busca da URL (`filters.q`) só muda quando a navegação do `router.push`
 * faz commit — até a resposta do servidor chegar, a prop continua a velha.
 * Por isso o campo não pode marcar a busca como vista já no envio: o render
 * seguinte, ainda com a prop velha, veria a diferença e devolveria o campo ao
 * termo anterior. O termo sumia durante a espera, o X parecia não funcionar e
 * a resposta atropelava o que a pessoa tinha digitado enquanto esperava.
 *
 * São duas lembranças separadas — a última busca da URL que o campo viu e a
 * que ele mesmo pediu —, e só uma mudança da URL que o campo NÃO pediu
 * reescreve o texto.
 */
export interface SearchField {
    /** O texto no campo. */
    query: string;
    /** A última busca da URL que o campo viu. */
    seen: string;
    /** A busca que o próprio campo pediu (Enter, X) e ainda não voltou; null se nenhuma. */
    asked: string | null;
}

export type SearchFieldEvent =
    /** A pessoa digitou. */
    | { type: 'input'; query: string }
    /** O campo pediu a busca `q` (Enter, X). A URL só a mostra quando a resposta chegar. */
    | { type: 'ask'; q: string }
    /** A busca que está na URL — conferida a cada render. */
    | { type: 'url'; q: string };

export function initialSearchField(q: string): SearchField {
    return { query: q, seen: q, asked: null };
}

export function searchFieldReducer(field: SearchField, event: SearchFieldEvent): SearchField {
    switch (event.type) {
        case 'input':
            return { ...field, query: event.query };

        case 'ask':
            return { ...field, query: event.q, asked: event.q };

        case 'url':
            if (event.q === field.seen) return field;

            return {
                // A resposta do que o próprio campo pediu: o texto fica — a
                // pessoa pode ter continuado digitando na espera. Mudou por
                // fora (Voltar, "Ver todas as contas"): o campo acompanha.
                query: event.q === field.asked ? field.query : event.q,
                seen: event.q,
                // Chegou a resposta, ou outra navegação passou na frente (o
                // roteador fica com a última e descarta as anteriores): de um
                // jeito ou de outro, o pedido acabou.
                asked: null,
            };
    }
}

/**
 * Há busca na URL, ou a caminho dela. O X precisa tirá-la de lá: só esvaziar
 * o campo deixaria a busca pendente chegar e filtrar a lista com o campo vazio.
 */
export function hasSearch(field: SearchField): boolean {
    return field.seen !== '' || Boolean(field.asked);
}

/**
 * Um <form> GET de verdade, apontado para /admin: sem JavaScript (ou antes da
 * hidratação) o navegador mesmo monta `?q=…&filter=…`. Com JavaScript a
 * navegação é do roteador, dentro da transição do painel.
 *
 * Busca no Enter, não a cada tecla: cada busca é uma entrada no histórico (o
 * Voltar desfaz a busca), e uma resposta atrasada não atropela o que a pessoa
 * continuou digitando.
 */
function SearchForm({ filters, navigate }: { filters: Filters; navigate: Navigate }) {
    const [field, dispatch] = useReducer(searchFieldReducer, filters.q, initialSearchField);
    const input = useRef<HTMLInputElement>(null);

    // Conferido no render, e não num effect, para não pintar o valor velho antes.
    if (filters.q !== field.seen) dispatch({ type: 'url', q: filters.q });

    const { query } = field;

    const go = (q: string) => {
        dispatch({ type: 'ask', q });
        navigate(adminHref({ q, filter: filters.filter }));
    };

    return (
        <form
            role="search"
            action="/admin"
            method="get"
            onSubmit={(event) => {
                event.preventDefault();
                go(query.trim());
            }}
            className="flex min-w-0 flex-1 gap-2"
        >
            {filters.filter !== 'all' && <input type="hidden" name="filter" value={filters.filter} />}

            <div className="relative min-w-0 flex-1">
                <Search
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-fg"
                    aria-hidden
                />
                <Input
                    ref={input}
                    type="search"
                    name="q"
                    value={query}
                    onChange={(event) => dispatch({ type: 'input', query: event.target.value })}
                    // Curto: em 390 px "Buscar por nome ou e-mail" era cortado
                    // pelo botão. A lupa e o botão já dizem que é busca.
                    placeholder="Nome ou e-mail"
                    aria-label="Buscar contas por nome ou e-mail"
                    maxLength={100}
                    enterKeyHint="search"
                    autoComplete="off"
                    spellCheck={false}
                    // O "x" nativo do type=search só esvazia o campo; o nosso
                    // também tira a busca da URL.
                    className="pl-9 pr-9 [&::-webkit-search-cancel-button]:appearance-none"
                />
                {query !== '' && (
                    <button
                        type="button"
                        aria-label="Limpar a busca"
                        onClick={() => {
                            input.current?.focus();

                            if (hasSearch(field)) go('');
                            else dispatch({ type: 'input', query: '' });
                        }}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-fg transition-colors hover:bg-surface-2 hover:text-foreground"
                    >
                        <X className="size-4" aria-hidden />
                    </button>
                )}
            </div>

            <Button type="submit" variant="secondary">
                Buscar
            </Button>
        </form>
    );
}

/**
 * Links, e não botões: cada filtro é um endereço (abre em outra aba, vai para
 * o histórico). O `onNavigate` só troca quem navega — o painel, dentro da
 * transição que esmaece a lista —, e a aba marcada muda no clique, otimista,
 * sem esperar o servidor.
 */
function FilterTabs({ filters, navigate }: { filters: Filters; navigate: Navigate }) {
    const [current, setCurrent] = useOptimistic(filters.filter);

    return (
        <nav aria-label="Filtrar contas" className="grid shrink-0 grid-cols-3 rounded-lg bg-surface-2 p-0.5 md:flex">
            {ADMIN_FILTERS.map(({ value, label }) => {
                const href = adminHref({ q: filters.q, filter: value });
                const active = current === value;

                return (
                    <Link
                        key={value}
                        href={href}
                        scroll={false}
                        aria-current={active ? 'page' : undefined}
                        onNavigate={(event) => {
                            event.preventDefault();
                            navigate(href, { optimistic: () => setCurrent(value) });
                        }}
                        className={cn(
                            'rounded-md px-3 py-1.5 text-center text-sm font-medium transition-colors duration-200',
                            active ? 'bg-surface text-foreground shadow-sm' : 'text-muted-fg hover:text-foreground',
                        )}
                    >
                        {label}
                    </Link>
                );
            })}
        </nav>
    );
}
