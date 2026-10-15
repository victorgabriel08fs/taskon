import { Ban, LockOpen, ScrollText, ShieldCheck, ShieldMinus, ShieldPlus, Sparkles, type LucideIcon } from 'lucide-react';
import { TimeAgo } from '@/components/time-ago';
import { cn } from '@/lib/utils';
import type { AdminEvent } from '@/types';

interface EventKind {
    icon: LucideIcon;
    tone: string;
}

const KINDS: Record<AdminEvent['type'], EventKind> = {
    'admin.granted': { icon: ShieldPlus, tone: 'bg-primary-soft text-primary' },
    'admin.revoked': { icon: ShieldMinus, tone: 'bg-surface-3 text-muted-fg' },
    'user.blocked': { icon: Ban, tone: 'bg-danger/12 text-danger' },
    'user.unblocked': { icon: LockOpen, tone: 'bg-success/12 text-success' },
    'admin.activated': { icon: ShieldCheck, tone: 'bg-primary text-primary-fg' },
};

// A coluna `type` é texto livre no banco: um tipo que a tela ainda não conhece
// aparece genérico em vez de derrubar o painel.
const UNKNOWN: EventKind = { icon: Sparkles, tone: 'bg-surface-3 text-muted-fg' };

const ACTIONS: Record<Exclude<AdminEvent['type'], 'admin.activated'>, string> = {
    'admin.granted': 'concedeu admin a',
    'admin.revoked': 'tirou o admin de',
    'user.blocked': 'bloqueou',
    'user.unblocked': 'desbloqueou',
};

/**
 * A frase de um evento, em partes (os nomes vão em destaque): "Victor
 * concedeu admin a Ana". `admin.activated` não tem alvo — é a conta nativa se
 * ativando, ator e alvo são a mesma —, então, se a conta sumiu, quem ativou é
 * o nome copiado na linha.
 */
export function describeAdminEvent(event: AdminEvent): { actor: string; action: string; target: string | null } {
    if (event.type === 'admin.activated') {
        return { actor: event.actor ?? event.target_name, action: 'ativou a administração', target: null };
    }

    return {
        actor: event.actor ?? 'Uma conta excluída',
        action: ACTIONS[event.type] ?? 'mexeu em',
        target: event.target_name,
    };
}

/**
 * Ações de poder sobre outras contas deixam rastro: quem concedeu ou tirou
 * admin, quem bloqueou ou desbloqueou quem. O servidor manda só as mais
 * recentes (config.admin.eventsShown).
 */
export function AdminHistory({ events }: { events: AdminEvent[] }) {
    return (
        <section aria-labelledby="admin-history-title" className="min-w-0 rounded-xl bg-surface p-5 ring-1 ring-border">
            <header className="mb-4">
                <h2 id="admin-history-title" className="flex items-center gap-2 text-sm font-semibold">
                    <ScrollText className="size-4 text-muted-fg" aria-hidden />
                    Histórico de administração
                </h2>
                <p className="mt-0.5 text-xs text-muted-fg">
                    Quem concedeu ou tirou admin, bloqueou ou desbloqueou quem — as ações mais recentes, da
                    última para a primeira.
                </p>
            </header>

            {events.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-fg">Nenhuma ação registrada ainda.</p>
            ) : (
                <ol className="space-y-3.5">
                    {events.map((event) => {
                        const kind = KINDS[event.type] ?? UNKNOWN;
                        const { actor, action, target } = describeAdminEvent(event);

                        return (
                            <li key={event.id} className="flex gap-3">
                                <span className={cn('grid size-7 shrink-0 place-items-center rounded-full', kind.tone)}>
                                    <kind.icon className="size-3.5" aria-hidden />
                                </span>

                                <p className="min-w-0 text-sm leading-relaxed text-muted-fg">
                                    <span className="font-medium text-foreground">{actor}</span> {action}
                                    {target !== null && (
                                        <>
                                            {' '}
                                            <span className="font-medium text-foreground">{target}</span>
                                        </>
                                    )}
                                    {/* Só o e-mail cede a largura e corta. Na mesma caixa com
                                        `truncate`, um e-mail comprido levava junto o horário, que
                                        vem por último — e o "quando" sumia no celular. */}
                                    <span className="mt-0.5 flex min-w-0 gap-1 text-xs">
                                        <span className="min-w-0 truncate">{event.target_email}</span>
                                        <span className="shrink-0">
                                            · <TimeAgo iso={event.created_at} />
                                        </span>
                                    </span>
                                </p>
                            </li>
                        );
                    })}
                </ol>
            )}
        </section>
    );
}
