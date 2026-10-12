'use client';

import { AlarmClock, CalendarDays, CheckCircle2, Mail, Send, TriangleAlert } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState, type ReactNode } from 'react';
import { useUser } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { runAction } from '@/lib/actions';
import { cn, formatRelative, pluralize } from '@/lib/utils';
import { sendTestDigest, updateDigestPreference } from '@/server/actions/notifications';
import type { NotificationSettingsData } from '@/server/services/daily-digest';

/**
 * Configurações › Notificações: o interruptor do resumo diário, a prévia do
 * que o e-mail de hoje diria e o envio de teste. A moldura (abas, título)
 * vem do SettingsLayout, na página.
 */
export function NotificationSettings({ dailyDigest, lastSentAt, sendAt, horizonDays, preview }: NotificationSettingsData) {
    const { email } = useUser();

    // Estado local para a chave virar na hora do clique; o servidor confirma
    // depois. Se a action falhar (ou a rede cair), a chave volta.
    const [enabled, setEnabled] = useState(dailyDigest);
    const [sending, setSending] = useState(false);

    async function toggle(next: boolean) {
        setEnabled(next);

        const result = await runAction(updateDigestPreference({ daily_digest: next }));

        if (!result?.ok) setEnabled(!next);
    }

    return (
        <>
            <div className="rounded-xl bg-surface p-5 ring-1 ring-border">
                <div className="flex items-start gap-4">
                    <span
                        className={cn(
                            'grid size-10 shrink-0 place-items-center rounded-lg transition-colors duration-300',
                            enabled ? 'bg-primary-soft text-primary' : 'bg-surface-2 text-muted-fg',
                        )}
                    >
                        <Mail className="size-5" />
                    </span>

                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">Resumo diário</p>
                        <p className="mt-0.5 text-sm text-muted-fg">
                            Todo dia às {sendAt}, para <span className="font-medium text-foreground">{email}</span>.
                            Entram as tarefas atribuídas a você que vencem nos próximos{' '}
                            {pluralize(horizonDays, 'dia', 'dias')} — e as que já passaram do prazo.
                        </p>
                    </div>

                    <Switch checked={enabled} onChange={toggle} label="Receber o resumo diário" />
                </div>

                <AnimatePresence initial={false}>
                    {enabled && (
                        <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                            className="overflow-hidden"
                        >
                            <div className="mt-5 border-t border-border pt-5">
                                <p className="text-xs font-semibold uppercase tracking-wide text-muted-fg">
                                    O que o e-mail de hoje diria
                                </p>

                                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                                    <PreviewTile
                                        icon={<TriangleAlert className="size-4" />}
                                        label="Vencidas"
                                        value={preview.overdue}
                                        tone="danger"
                                        index={0}
                                    />
                                    <PreviewTile
                                        icon={<AlarmClock className="size-4" />}
                                        label="Hoje"
                                        value={preview.today}
                                        tone="warning"
                                        index={1}
                                    />
                                    <PreviewTile
                                        icon={<CalendarDays className="size-4" />}
                                        label="A seguir"
                                        value={preview.upcoming}
                                        tone="primary"
                                        index={2}
                                    />
                                    <PreviewTile
                                        icon={<CheckCircle2 className="size-4" />}
                                        label="Concluídas 24 h"
                                        value={preview.completed}
                                        tone="success"
                                        index={3}
                                    />
                                </div>

                                {preview.overdue + preview.today + preview.upcoming + preview.completed === 0 && (
                                    <p className="mt-3 text-xs text-muted-fg">
                                        Com esses números o envio de hoje seria pulado — caixa de entrada limpa vale
                                        mais que constância.
                                    </p>
                                )}

                                <div className="mt-5 flex flex-wrap items-center gap-3">
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        loading={sending}
                                        onClick={() => {
                                            setSending(true);
                                            void runAction(sendTestDigest(), { onFinish: () => setSending(false) });
                                        }}
                                    >
                                        <Send className="size-4" />
                                        Enviar agora para mim
                                    </Button>

                                    {/* "há 3 horas" depende do relógio, que anda entre o SSR e a hidratação. */}
                                    <span className="text-xs text-muted-fg" suppressHydrationWarning>
                                        {lastSentAt
                                            ? `Último envio ${formatRelative(lastSentAt)}.`
                                            : 'Nenhum resumo enviado ainda.'}
                                    </span>
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            <p className="mt-4 text-xs leading-relaxed text-muted-fg">
                O envio de teste não conta como o resumo do dia: você continua recebendo o automático no horário.
            </p>
        </>
    );
}

const TONES = {
    danger: 'text-danger bg-danger/10',
    warning: 'text-warning bg-warning/12',
    primary: 'text-primary bg-primary-soft',
    success: 'text-success bg-success/12',
} as const;

function PreviewTile({
    icon,
    label,
    value,
    tone,
    index,
}: {
    icon: ReactNode;
    label: string;
    value: number;
    tone: keyof typeof TONES;
    index: number;
}) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: index * 0.05, ease: [0.22, 1, 0.36, 1] }}
            className="rounded-lg bg-surface-2 p-3"
        >
            <span
                className={cn(
                    'inline-grid size-7 place-items-center rounded-md',
                    value > 0 ? TONES[tone] : 'bg-surface-3 text-muted-fg',
                )}
            >
                {icon}
            </span>
            <p className="mt-2 text-xl font-bold tabular-nums">{value}</p>
            <p className="text-[11px] font-medium text-muted-fg">{label}</p>
        </motion.div>
    );
}
