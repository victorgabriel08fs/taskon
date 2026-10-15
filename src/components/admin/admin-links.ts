import type { AdminFilter } from '@/types';

/** As abas da lista de contas, na ordem em que aparecem. */
export const ADMIN_FILTERS: readonly { value: AdminFilter; label: string }[] = [
    { value: 'all', label: 'Todos' },
    { value: 'admins', label: 'Admins' },
    { value: 'blocked', label: 'Bloqueados' },
];

/**
 * O endereço de um estado da lista. Busca, filtro e página moram na URL, e não
 * num useState, para sobreviverem ao F5, ao Voltar e a um link colado no chat.
 * O que é padrão (sem busca, 'all', página 1) fica de fora: /admin limpo.
 */
export function adminHref({ q = '', filter = 'all', page = 1 }: { q?: string; filter?: AdminFilter; page?: number }): string {
    const params = new URLSearchParams();

    if (q) params.set('q', q);
    if (filter !== 'all') params.set('filter', filter);
    if (page > 1) params.set('page', String(page));

    const query = params.toString();

    return query ? `/admin?${query}` : '/admin';
}

/**
 * Troca o estado da lista pela URL dentro de uma transição do painel, que
 * esmaece a lista até a página nova chegar. `optimistic` roda dentro da mesma
 * transição (o filtro marcado muda no clique); `toList` rola até o topo da
 * lista quando a resposta chega (a paginação fica no fim dela).
 */
export type Navigate = (href: string, options?: { optimistic?: () => void; toList?: boolean }) => void;
