'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { adminHref, type Navigate } from '@/components/admin/admin-links';
import { cn } from '@/lib/utils';
import type { AdminPanelData } from '@/types';

const step =
    'inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-xs font-medium ring-1 ring-border ' +
    'transition-[transform,background-color] duration-150 ease-out';

/**
 * Anterior/próxima com "página X de Y". Os links levam a busca e o filtro
 * junto — e são os normalizados pelo servidor, não os crus da URL: uma
 * `?page=99` vira a última página, e o "Próxima" não aponta para o vazio.
 */
export function AccountPagination({
    pagination,
    filters,
    navigate,
}: {
    pagination: AdminPanelData['pagination'];
    filters: AdminPanelData['filters'];
    navigate: Navigate;
}) {
    const { page, pages } = pagination;

    if (pages <= 1) return null;

    return (
        <nav
            aria-label="Páginas da lista de contas"
            className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-5"
        >
            <PageStep direction="previous" page={page - 1} enabled={page > 1} filters={filters} navigate={navigate} />

            <p className="text-xs text-muted-fg">
                Página <span className="font-semibold text-foreground tabular-nums">{page}</span> de{' '}
                <span className="tabular-nums">{pages}</span>
            </p>

            <PageStep direction="next" page={page + 1} enabled={page < pages} filters={filters} navigate={navigate} />
        </nav>
    );
}

function PageStep({
    direction,
    page,
    enabled,
    filters,
    navigate,
}: {
    direction: 'previous' | 'next';
    page: number;
    enabled: boolean;
    filters: AdminPanelData['filters'];
    navigate: Navigate;
}) {
    const content =
        direction === 'previous' ? (
            <>
                <ChevronLeft className="size-4" aria-hidden />
                Anterior
            </>
        ) : (
            <>
                Próxima
                <ChevronRight className="size-4" aria-hidden />
            </>
        );

    // Na ponta não há para onde ir: o lugar fica (o "Página X de Y" não pula
    // de lado), mas fora da árvore de acessibilidade — o texto do meio já diz
    // que é a primeira ou a última.
    if (!enabled) {
        return (
            <span aria-hidden className={cn(step, 'cursor-default text-muted-fg opacity-45')}>
                {content}
            </span>
        );
    }

    const href = adminHref({ q: filters.q, filter: filters.filter, page });

    return (
        <Link
            href={href}
            scroll={false}
            rel={direction === 'previous' ? 'prev' : 'next'}
            aria-label={direction === 'previous' ? 'Página anterior' : 'Próxima página'}
            onNavigate={(event) => {
                event.preventDefault();
                navigate(href, { toList: true });
            }}
            className={cn(step, 'bg-surface-2 text-foreground hover:bg-surface-3 active:scale-[0.97]')}
        >
            {content}
        </Link>
    );
}
