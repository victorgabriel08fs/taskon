'use client';

import { Ban, ShieldCheck, SquareKanban, UsersRound } from 'lucide-react';
import { countLabel } from '@/components/admin/format';
import { StatCard } from '@/components/dashboard/stat-card';
import type { AdminStats } from '@/types';

/**
 * Os números do Taskon inteiro, com o mesmo cartão do painel (/dashboard): o
 * número sobe ao aparecer e, depois de uma ação, anda do valor velho para o
 * novo — bloquear alguém faz o "Bloqueados" contar mais um na frente da pessoa.
 */
export function AdminStatsGrid({ stats }: { stats: AdminStats }) {
    return (
        // Duas colunas já no celular: quatro cartões empilhados empurrariam a
        // lista de contas para longe da primeira tela.
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatCard
                index={0}
                tone="primary"
                label="Contas"
                value={stats.users}
                icon={<UsersRound className="size-4.5" />}
                hint={
                    stats.new_this_week > 0
                        ? `+${countLabel(stats.new_this_week, 'nova', 'novas')} em 7 dias`
                        : 'Nenhuma nova em 7 dias'
                }
            />
            <StatCard
                index={1}
                tone="success"
                label="Admins"
                value={stats.admins}
                icon={<ShieldCheck className="size-4.5" />}
                hint="Nativos e concedidos, fora os bloqueados"
            />
            <StatCard
                index={2}
                tone="danger"
                label="Bloqueados"
                value={stats.blocked}
                icon={<Ban className="size-4.5" />}
                hint={stats.blocked === 0 ? 'Ninguém bloqueado' : 'Sem acesso ao Taskon'}
            />
            <StatCard
                index={3}
                tone="warning"
                label="Quadros"
                value={stats.boards}
                icon={<SquareKanban className="size-4.5" />}
                hint={`${countLabel(stats.cards, 'card', 'cards')} no total`}
            />
        </div>
    );
}
