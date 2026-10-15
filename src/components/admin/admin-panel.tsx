'use client';

import { Crown, Loader2, ShieldCheck } from 'lucide-react';
import { motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useTransition } from 'react';
import { useAccountActions } from '@/components/admin/account-actions';
import { AccountList, NoAccounts } from '@/components/admin/account-list';
import { AccountPagination } from '@/components/admin/account-pagination';
import { AccountToolbar } from '@/components/admin/account-toolbar';
import { AdminHistory } from '@/components/admin/admin-history';
import type { Navigate } from '@/components/admin/admin-links';
import { AdminStatsGrid } from '@/components/admin/admin-stats';
import { countLabel, formatCount } from '@/components/admin/format';
import { AppLayout } from '@/components/layouts/app-layout';
import { cn } from '@/lib/utils';
import type { AdminPanelData } from '@/types';

/**
 * O painel /admin: números do Taskon, a lista de contas (busca, filtro e
 * página pela URL) e o histórico de administração.
 *
 * Busca, filtro e página trocam só a query string — o pathname é o mesmo, e a
 * barra de progresso do topo, que espera o pathname mudar, não liga (ficaria
 * presa). O sinal de espera é daqui: toda troca passa por `navigate`, dentro de
 * uma transição, e a lista esmaece até a página nova chegar.
 */
export function AdminPanel({ viewer, stats, users, pagination, filters, events }: AdminPanelData) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const actions = useAccountActions();
    const listHeading = useRef<HTMLHeadingElement>(null);
    const scrollToList = useRef(false);

    const navigate: Navigate = (href, options) => {
        scrollToList.current = options?.toList ?? false;

        startTransition(() => {
            options?.optimistic?.();
            router.push(href, { scroll: false });
        });
    };

    // A paginação fica no fim da lista: sem isto, "Próxima" deixaria a pessoa
    // olhando o fim da página nova. O foco vai junto para o título da lista,
    // e o leitor de tela recomeça dali.
    useEffect(() => {
        if (!scrollToList.current) return;

        scrollToList.current = false;
        listHeading.current?.scrollIntoView({ block: 'start' });
        listHeading.current?.focus({ preventScroll: true });
    }, [users]);

    const native = viewer.access === 'native';

    return (
        <AppLayout>
            <div className="mx-auto w-full max-w-6xl px-5 py-8">
                <motion.header
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                        <h1 className="text-2xl font-bold tracking-tight">Administração</h1>
                        <span
                            className={cn(
                                'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold',
                                // Como nos selos da lista de contas: na tinta, o texto em
                                // `foreground` e o roxo só no ícone (texto roxo sobre a tinta
                                // roxa fica abaixo do contraste mínimo, nos dois temas).
                                native
                                    ? 'bg-primary text-primary-fg'
                                    : 'bg-primary-soft text-foreground [&>svg]:text-primary',
                            )}
                        >
                            {native ? (
                                <Crown className="size-3.5" aria-hidden />
                            ) : (
                                <ShieldCheck className="size-3.5" aria-hidden />
                            )}
                            {native ? 'Admin nativo' : 'Admin'}
                        </span>
                    </div>
                    <p className="mt-1 max-w-2xl text-sm text-muted-fg">
                        {native
                            ? 'Você é admin nativo: concede e tira admin, bloqueia e desbloqueia contas — menos a sua e as de e-mail nativo.'
                            : 'Você é admin: bloqueia e desbloqueia contas comuns. Conceder ou tirar admin, e mexer em outros admins, fica com o admin nativo.'}
                    </p>
                </motion.header>

                <div className="mt-8">
                    <AdminStatsGrid stats={stats} />
                </div>

                <section
                    aria-labelledby="admin-accounts-title"
                    className="mt-6 min-w-0 rounded-xl bg-surface ring-1 ring-border"
                >
                    <div className="space-y-4 border-b border-border p-4 sm:p-5">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                            {/* scroll-mt: o cabeçalho do app é fixo e cobriria o título. */}
                            <h2
                                id="admin-accounts-title"
                                ref={listHeading}
                                tabIndex={-1}
                                className="scroll-mt-20 text-sm font-semibold"
                            >
                                Contas
                            </h2>

                            {/* Anunciado ao leitor de tela quando a busca ou o filtro trocam a lista. */}
                            <p aria-live="polite" className="flex min-w-0 items-center gap-1.5 text-xs text-muted-fg">
                                {pending && <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />}
                                <span className="min-w-0 truncate">
                                    {summaryOf(pagination)}
                                    {filters.q && ` para “${filters.q}”`}
                                </span>
                            </p>
                        </div>

                        <AccountToolbar filters={filters} navigate={navigate} />
                    </div>

                    <div aria-busy={pending} className={cn('transition-opacity duration-200', pending && 'opacity-55')}>
                        {users.length === 0 ? (
                            <NoAccounts filters={filters} navigate={navigate} />
                        ) : (
                            <AccountList users={users} actions={actions} />
                        )}
                    </div>

                    <AccountPagination pagination={pagination} filters={filters} navigate={navigate} />
                </section>

                <div className="mt-6">
                    <AdminHistory events={events} />
                </div>
            </div>

            {actions.dialog}
        </AppLayout>
    );
}

/** "37 contas", ou "26–37 de 37 contas" quando há mais de uma página. */
function summaryOf({ page, per_page, total, pages }: AdminPanelData['pagination']): string {
    if (total === 0) return 'Nenhuma conta';

    const all = countLabel(total, 'conta', 'contas');

    if (pages <= 1) return all;

    const from = (page - 1) * per_page + 1;
    const to = Math.min(page * per_page, total);

    return `${formatCount(from)}–${formatCount(to)} de ${all}`;
}
