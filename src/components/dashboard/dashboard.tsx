'use client';

import {
    Activity as ActivityIcon,
    AlarmClock,
    ArrowRight,
    CalendarDays,
    CheckCircle2,
    LayoutGrid,
    ListTodo,
    Plus,
    TriangleAlert,
} from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { Suspense, use, type ReactNode } from 'react';
import { BoardProgressList } from '@/components/dashboard/board-progress';
import { DeadlineList } from '@/components/dashboard/deadline-list';
import { DonutChart, type DonutSegment } from '@/components/dashboard/donut-chart';
import { StatCard } from '@/components/dashboard/stat-card';
import { TrendChart } from '@/components/dashboard/trend-chart';
import { AppLayout } from '@/components/layouts/app-layout';
import { useUser } from '@/components/providers';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useReveal } from '@/hooks/use-reveal';
import { wallClock } from '@/lib/timezone';
import { formatRelative, pluralize } from '@/lib/utils';
import type { DashboardData } from '@/server/queries/dashboard';
import type { Activity } from '@/types';

interface DashboardProps extends DashboardData {
    /**
     * O feed chega depois da primeira pintura: o servidor manda a Promise sem
     * esperar por ela, e o painel a lê dentro de um <Suspense>.
     */
    activity: Promise<Activity[] | null>;
}

export function Dashboard({ stats, breakdown, deadlines, trend, boards, horizonDays, activity }: DashboardProps) {
    const user = useUser();
    const reveal = useReveal<HTMLDivElement>();

    // Sem base de comparação não existe percentual — mostrar "+100%" porque a
    // semana passada foi zero é enfeite, não informação.
    const trendPercent =
        stats.completed_previous_week > 0
            ? Math.round(
                  ((stats.completed_week - stats.completed_previous_week) / stats.completed_previous_week) * 100,
              )
            : null;

    const segments: DonutSegment[] = [
        { key: 'overdue', label: 'Vencidas', value: breakdown.overdue, color: 'var(--danger)' },
        { key: 'today', label: 'Vencem hoje', value: breakdown.today, color: 'var(--warning)' },
        {
            key: 'upcoming',
            label: `Próximos ${horizonDays} dias`,
            value: breakdown.upcoming,
            color: 'var(--primary)',
        },
        {
            key: 'later',
            label: 'Mais adiante',
            value: breakdown.later,
            color: 'color-mix(in oklch, var(--primary) 45%, var(--surface-3))',
        },
        {
            key: 'none',
            label: 'Sem prazo',
            value: breakdown.none,
            color: 'color-mix(in oklch, var(--muted-fg) 45%, transparent)',
        },
    ];

    return (
        <AppLayout>
            <div ref={reveal} className="mx-auto w-full max-w-6xl px-5 py-8">
                <motion.header
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                    className="flex flex-wrap items-end justify-between gap-4"
                >
                    <div>
                        {/* A saudação depende do relógio, que anda entre o SSR e a hidratação. */}
                        <h1 className="text-2xl font-bold tracking-tight" suppressHydrationWarning>
                            {greeting()}, {user.name.split(' ')[0]}.
                        </h1>
                        <p className="mt-1 text-sm text-muted-fg">
                            {stats.overdue > 0
                                ? `${pluralize(stats.overdue, 'tarefa passou', 'tarefas passaram')} do prazo — comece por elas.`
                                : stats.today > 0
                                  ? `${pluralize(stats.today, 'tarefa vence', 'tarefas vencem')} hoje.`
                                  : 'Nada vencendo hoje. Um bom dia para adiantar o que vem aí.'}
                        </p>
                    </div>

                    <Link href="/boards">
                        <Button variant="secondary">
                            <LayoutGrid className="size-4" />
                            Meus quadros
                        </Button>
                    </Link>
                </motion.header>

                {stats.boards === 0 ? (
                    <EmptyState />
                ) : (
                    <>
                        <SectionLabel
                            title="Suas tarefas"
                            hint="Só os cards atribuídos a você — o mesmo recorte do e-mail diário."
                        />

                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            <StatCard
                                index={0}
                                tone="danger"
                                label="Vencidas"
                                value={stats.overdue}
                                icon={<TriangleAlert className="size-4.5" />}
                                hint={stats.overdue === 0 ? 'Nada atrasado' : 'Precisam de atenção'}
                            />
                            <StatCard
                                index={1}
                                tone="warning"
                                label="Vencem hoje"
                                value={stats.today}
                                icon={<AlarmClock className="size-4.5" />}
                                hint="Até o fim do dia"
                            />
                            <StatCard
                                index={2}
                                tone="primary"
                                label={`Próximos ${horizonDays} dias`}
                                value={stats.upcoming}
                                icon={<CalendarDays className="size-4.5" />}
                                hint={`${stats.open} em aberto no total`}
                            />
                            <StatCard
                                index={3}
                                tone="success"
                                label="Concluídas na semana"
                                value={stats.completed_week}
                                icon={<CheckCircle2 className="size-4.5" />}
                                trend={trendPercent}
                                hint="Comparado à semana anterior"
                            />
                        </div>

                        <div data-reveal className="reveal mt-4 grid gap-4 lg:grid-cols-[1fr_22rem]">
                            <Panel
                                title="Ritmo"
                                subtitle={`Cards criados e concluídos nos últimos ${trend.length} dias, em todos os seus quadros`}
                            >
                                <TrendChart points={trend} />
                            </Panel>

                            <Panel title="Por prazo" subtitle="Suas tarefas abertas">
                                <div className="pt-2">
                                    <DonutChart segments={segments} caption="tarefas abertas" />
                                </div>
                            </Panel>
                        </div>

                        <div data-reveal className="reveal mt-4 grid gap-4 lg:grid-cols-2">
                            <Panel
                                title="Próximos prazos"
                                subtitle="Vencidas primeiro"
                                action={
                                    deadlines.length > 0 && (
                                        <Link
                                            href={`/boards/${deadlines[0].board_id}`}
                                            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                                        >
                                            Abrir quadro
                                            <ArrowRight className="size-3.5" />
                                        </Link>
                                    )
                                }
                            >
                                <DeadlineList deadlines={deadlines} />
                            </Panel>

                            <Panel title="Progresso por quadro" subtitle="Todos os cards, não só os seus">
                                <BoardProgressList boards={boards} />
                            </Panel>
                        </div>

                        <div data-reveal className="reveal mt-4">
                            <Panel title="Atividade recente" subtitle="O que mudou nos seus quadros">
                                <Suspense fallback={<ActivitySkeleton />}>
                                    <ActivityFeed activity={activity} />
                                </Suspense>
                            </Panel>
                        </div>
                    </>
                )}
            </div>
        </AppLayout>
    );
}

/**
 * A hora do fuso do app, não a do processo: o servidor da Vercel roda em UTC,
 * e a saudação do SSR diria "Boa tarde" às 9 da manhã de São Paulo.
 */
function greeting(): string {
    const hour = wallClock(new Date()).hour;

    if (hour < 12) return 'Bom dia';
    if (hour < 18) return 'Boa tarde';

    return 'Boa noite';
}

function SectionLabel({ title, hint }: { title: string; hint: string }) {
    return (
        <div className="mb-4 mt-9 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-fg">
                <ListTodo className="size-4" />
                {title}
            </h2>
            <p className="text-xs text-muted-fg opacity-80">{hint}</p>
        </div>
    );
}

function Panel({
    title,
    subtitle,
    action,
    children,
}: {
    title: string;
    subtitle?: string;
    action?: ReactNode;
    children: ReactNode;
}) {
    return (
        <section className="rounded-xl bg-surface p-5 ring-1 ring-border">
            <header className="mb-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="text-sm font-semibold">{title}</h3>
                    {subtitle && <p className="mt-0.5 text-xs text-muted-fg">{subtitle}</p>}
                </div>
                {action}
            </header>

            {children}
        </section>
    );
}

/** O esqueleto do feed enquanto a Promise do servidor não resolve. */
function ActivitySkeleton() {
    return (
        <ul className="space-y-3.5">
            {Array.from({ length: 4 }).map((_, index) => (
                <li key={index} className="flex gap-3">
                    <span className="size-7 shrink-0 animate-pulse rounded-full bg-surface-3" />
                    <span className="h-7 flex-1 animate-pulse rounded-lg bg-surface-3" />
                </li>
            ))}
        </ul>
    );
}

function ActivityFeed({ activity }: { activity: Promise<Activity[] | null> }) {
    const items = use(activity);

    if (items === null) {
        return (
            <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-fg">
                <ActivityIcon className="size-4" />
                Não deu para carregar a atividade agora.
            </p>
        );
    }

    if (items.length === 0) {
        return (
            <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-fg">
                <ActivityIcon className="size-4" />
                Nada por aqui ainda.
            </p>
        );
    }

    return (
        <ul className="space-y-3.5">
            {items.map((item, index) => (
                <motion.li
                    key={item.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: Math.min(index, 8) * 0.04 }}
                    className="flex gap-3"
                >
                    {item.user ? (
                        <Avatar user={item.user} size="sm" />
                    ) : (
                        <span className="size-7 shrink-0 rounded-full bg-surface-3" />
                    )}

                    <p className="min-w-0 text-sm leading-relaxed text-muted-fg">
                        <span className="font-medium text-foreground">{item.user?.name ?? 'Sistema'}</span>{' '}
                        {item.description}
                        {/* "há 3 horas" depende do relógio, que anda entre o SSR e a hidratação. */}
                        <span className="mt-0.5 block text-xs opacity-70" suppressHydrationWarning>
                            {formatRelative(item.created_at)}
                            {item.board && ` · ${item.board.title}`}
                        </span>
                    </p>
                </motion.li>
            ))}
        </ul>
    );
}

function EmptyState() {
    return (
        <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
            className="mt-10 grid place-items-center gap-3 rounded-xl border-2 border-dashed border-border bg-surface/40 px-6 py-16 text-center"
        >
            <span className="grid size-12 place-items-center rounded-full bg-primary-soft text-primary">
                <LayoutGrid className="size-6" />
            </span>
            <h2 className="text-lg font-semibold">Seu painel está esperando dados</h2>
            <p className="max-w-sm text-sm text-muted-fg">
                Crie um quadro, adicione alguns cards com prazo e os gráficos aparecem aqui — junto com o resumo
                diário no seu e-mail.
            </p>
            <Link href="/boards" className="mt-1">
                <Button>
                    <Plus className="size-4" />
                    Criar meu primeiro quadro
                </Button>
            </Link>
        </motion.div>
    );
}
