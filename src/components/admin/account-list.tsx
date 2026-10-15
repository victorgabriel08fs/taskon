'use client';

import { BadgeCheck, SearchX } from 'lucide-react';
import Link from 'next/link';
import { AccountActionButtons, type AccountActions } from '@/components/admin/account-actions';
import { AccountBadges } from '@/components/admin/account-badges';
import { ADMIN_FILTERS, type Navigate } from '@/components/admin/admin-links';
import { countLabel, formatAccountDate, formatCount } from '@/components/admin/format';
import { useUser } from '@/components/providers';
import { TimeAgo } from '@/components/time-ago';
import { Avatar } from '@/components/ui/avatar';
import type { AdminPanelData, AdminUserRow } from '@/types';

type RowActions = Pick<AccountActions, 'request' | 'running'>;

/**
 * As contas: tabela a partir de `lg`, cartões abaixo. São duas marcações, uma
 * escondida por CSS (`display: none` também a tira da árvore de
 * acessibilidade), porque uma tabela de cinco colunas não cabe em 390 px sem
 * rolar a página de lado — e uma tabela que vira cartão só com CSS perde a
 * semântica de tabela justamente onde ela ajuda.
 */
export function AccountList({ users, actions }: { users: AdminUserRow[]; actions: RowActions }) {
    const viewer = useUser();

    return (
        <>
            <table className="hidden w-full table-fixed text-sm lg:table">
                <caption className="sr-only">Contas do Taskon</caption>
                <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-fg">
                        <th scope="col" className="py-2.5 pl-5 pr-3 font-medium">
                            Conta
                        </th>
                        <th scope="col" className="w-40 px-3 py-2.5 font-medium">
                            Criada em
                        </th>
                        <th scope="col" className="w-36 px-3 py-2.5 font-medium">
                            Visto por último
                        </th>
                        <th scope="col" className="w-20 px-3 py-2.5 text-right font-medium">
                            Quadros
                        </th>
                        <th scope="col" className="w-70 py-2.5 pl-3 pr-5">
                            <span className="sr-only">Ações</span>
                        </th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-border">
                    {users.map((row) => (
                        <tr key={row.id} className="transition-colors duration-150 hover:bg-surface-2/60">
                            <td className="py-3 pl-5 pr-3">
                                <AccountIdentity row={row} isViewer={row.id === viewer.id} />
                            </td>
                            <td className="px-3 py-3 text-muted-fg">{formatAccountDate(row.created_at)}</td>
                            <td className="px-3 py-3 text-muted-fg">
                                {row.last_seen_at ? (
                                    <TimeAgo iso={row.last_seen_at} />
                                ) : (
                                    <>
                                        <span aria-hidden>—</span>
                                        <span className="sr-only">Sem sessão ativa</span>
                                    </>
                                )}
                            </td>
                            <td className="px-3 py-3 text-right tabular-nums">
                                {formatCount(row.boards_count)}
                            </td>
                            <td className="py-3 pl-3 pr-5">
                                <AccountActionButtons row={row} actions={actions} className="justify-end" />
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>

            <ul className="divide-y divide-border lg:hidden" aria-label="Contas do Taskon">
                {users.map((row) => (
                    <li key={row.id} className="px-4 py-4 sm:px-5">
                        <AccountIdentity row={row} isViewer={row.id === viewer.id} />

                        {/* pl-12: alinhado ao texto, depois do avatar (2.25rem + o gap de 0.75rem). */}
                        <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 pl-12 text-xs text-muted-fg">
                            <span>Criada em {formatAccountDate(row.created_at)}</span>
                            <span>
                                {row.last_seen_at ? (
                                    <>
                                        Visto <TimeAgo iso={row.last_seen_at} />
                                    </>
                                ) : (
                                    'Sem sessão ativa'
                                )}
                            </span>
                            <span>{countLabel(row.boards_count, 'quadro', 'quadros')}</span>
                        </p>

                        <AccountActionButtons row={row} actions={actions} className="mt-3 pl-12" />
                    </li>
                ))}
            </ul>
        </>
    );
}

/** Avatar, nome com os selos e e-mail — o mesmo bloco na tabela e no cartão. */
function AccountIdentity({ row, isViewer }: { row: AdminUserRow; isViewer: boolean }) {
    return (
        <div className="flex min-w-0 items-center gap-3">
            <Avatar user={row} size="md" />

            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="min-w-0 max-w-full truncate font-medium">{row.name}</span>
                    <AccountBadges row={row} isViewer={isViewer} />
                </div>

                <p className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-muted-fg">
                    <span className="truncate" title={row.email}>
                        {row.email}
                    </span>
                    {row.email_verified && (
                        <span title="E-mail confirmado" className="shrink-0 text-success">
                            <BadgeCheck className="size-3.5" aria-hidden />
                            <span className="sr-only">(e-mail confirmado)</span>
                        </span>
                    )}
                </p>
            </div>
        </div>
    );
}

/**
 * Lista vazia: a busca ou o filtro não acharam ninguém. Sem busca e sem
 * filtro não acontece (quem vê o painel é uma conta), mas a frase cobre.
 */
export function NoAccounts({ filters, navigate }: { filters: AdminPanelData['filters']; navigate: Navigate }) {
    const filterLabel = ADMIN_FILTERS.find(({ value }) => value === filters.filter)?.label ?? '';
    const narrowed = filters.q !== '' || filters.filter !== 'all';

    const hint = filters.q
        ? `Nada combina com “${filters.q}”${filters.filter === 'all' ? '' : ` em ${filterLabel}`}. Tente um pedaço do nome ou do e-mail.`
        : filters.filter === 'blocked'
          ? 'Ninguém está bloqueado agora.'
          : filters.filter === 'admins'
            ? 'Nenhum admin por aqui.'
            : 'Ainda não há contas.';

    return (
        <div className="grid place-items-center gap-2 px-6 py-14 text-center">
            <span className="grid size-11 place-items-center rounded-full bg-surface-2 text-muted-fg">
                <SearchX className="size-5" aria-hidden />
            </span>
            <p className="text-sm font-medium">Nenhuma conta encontrada</p>
            {/* O termo buscado pode ser uma palavra só de até 100 caracteres (um
                token colado). `break-words` não basta: não baixa o min-content,
                que é o que dá a largura da trilha do grid, e a página rolaria de
                lado no celular. `wrap-anywhere` baixa. */}
            <p className="max-w-sm text-xs wrap-anywhere text-muted-fg">{hint}</p>

            {narrowed && (
                <Link
                    href="/admin"
                    scroll={false}
                    onNavigate={(event) => {
                        event.preventDefault();
                        navigate('/admin');
                    }}
                    className="mt-1 text-sm font-semibold text-primary underline-offset-4 hover:underline"
                >
                    Ver todas as contas
                </Link>
            )}
        </div>
    );
}
