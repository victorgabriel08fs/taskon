'use client';

import { MailCheck, ShieldCheck } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { durationLabel } from '@/components/admin/format';
import { AppLayout } from '@/components/layouts/app-layout';
import { useUser } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { runAction } from '@/lib/actions';
import { requestEmailVerification } from '@/server/actions/email-verification';

/**
 * O /admin de quem tem o e-mail da lista de admins nativos mas ainda não
 * provou que a caixa de entrada é dele. O painel só liga depois da prova —
 * esta tela explica o porquê e manda o link.
 */
export function AdminActivation({ expiresInMinutes }: { expiresInMinutes: number }) {
    const user = useUser();
    const [sending, setSending] = useState(false);
    const [sent, setSent] = useState(false);

    return (
        <AppLayout>
            <div className="mx-auto w-full max-w-xl px-5 py-10 sm:py-14">
                <motion.section
                    aria-labelledby="admin-activation-title"
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                    className="rounded-xl bg-surface p-6 ring-1 ring-border sm:p-8"
                >
                    <span className="grid size-12 place-items-center rounded-full bg-primary-soft text-primary">
                        <ShieldCheck className="size-6" aria-hidden />
                    </span>

                    <h1 id="admin-activation-title" className="mt-5 text-xl font-bold tracking-tight">
                        Ative a administração
                    </h1>
                    <p className="mt-2 text-sm text-muted-fg">
                        <span className="break-all font-medium text-foreground">{user.email}</span> é um e-mail de admin
                        nativo do Taskon. Antes de abrir o painel, confirme que essa caixa de entrada é sua.
                    </p>

                    <div className="mt-5 rounded-lg bg-surface-2 p-4 text-sm">
                        <p className="font-medium">Por que confirmar?</p>
                        <p className="mt-1 text-muted-fg">
                            O cadastro não confirma e-mail, e a lista de admins nativos está no código, que é público.
                            Sem essa prova, qualquer pessoa poderia criar uma conta com este endereço — ou trocar o
                            próprio e-mail para ele — e virar admin.
                        </p>
                    </div>

                    <Button
                        className="mt-6 w-full sm:w-auto"
                        variant={sent ? 'secondary' : 'primary'}
                        loading={sending}
                        onClick={() => {
                            setSending(true);

                            void runAction(() => requestEmailVerification(), {
                                onSuccess: () => setSent(true),
                                onFinish: () => setSending(false),
                            });
                        }}
                    >
                        {!sending && <MailCheck className="size-4" aria-hidden />}
                        {sent ? 'Enviar outro link' : 'Enviar link de confirmação'}
                    </Button>

                    {/* O toast confirma o envio; aqui fica o que fazer com o e-mail. */}
                    <p role="status" className="mt-3 text-sm text-muted-fg">
                        {sent &&
                            `Abra o e-mail e use o botão “Confirmar e-mail”. O link vale ${durationLabel(expiresInMinutes)} ` +
                                'e funciona uma vez só — pedir outro invalida o anterior.'}
                    </p>
                </motion.section>
            </div>
        </AppLayout>
    );
}
