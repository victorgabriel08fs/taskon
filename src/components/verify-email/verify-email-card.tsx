'use client';

import { MailCheck } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { runAction } from '@/lib/actions';
import { confirmEmail } from '@/server/actions/email-verification';
import type { EmailVerificationPreview } from '@/types';

/**
 * O e-mail a confirmar e o botão. Confirmar é um POST (a action), não o GET do
 * link: os filtros de e-mail abrem os links das mensagens para inspecioná-los,
 * e se abrir a página bastasse, eles gastariam o token antes da pessoa.
 */
export function VerifyEmailCard({
    token,
    preview,
    viewerEmail,
}: {
    token: string;
    preview: EmailVerificationPreview;
    /** E-mail de quem está logado neste navegador, ou null para visitante. */
    viewerEmail: string | null;
}) {
    const [confirming, setConfirming] = useState(false);

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3 rounded-xl bg-surface p-4 ring-1 ring-border">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
                    <MailCheck className="size-5" aria-hidden />
                </span>
                {/* O e-mail aparece inteiro (é o que se está confirmando) e quebra
                    em qualquer ponto: `wrap-anywhere` é o único `overflow-wrap` que
                    conta no min-content, então um e-mail longo não alarga a coluna
                    do AuthLayout para fora da tela do celular. */}
                <div className="min-w-0">
                    <p className="wrap-anywhere text-sm font-semibold">{preview.email}</p>
                    <p className="wrap-anywhere text-xs text-muted-fg">Conta de {preview.name}</p>
                </div>
            </div>

            {/* O link prova a caixa de entrada, não a sessão: confirmar logado em
                outra conta confirma a do link — melhor dizer antes do clique. */}
            {viewerEmail !== null && viewerEmail !== preview.email && (
                <p className="rounded-lg bg-warning/12 px-3.5 py-2.5 text-sm text-foreground">
                    Você está conectado como <span className="font-medium wrap-anywhere">{viewerEmail}</span>. A
                    confirmação vale para a conta de <span className="font-medium wrap-anywhere">{preview.email}</span>,
                    não para a sua.
                </p>
            )}

            <Button
                size="lg"
                className="w-full"
                loading={confirming}
                onClick={() => {
                    setConfirming(true);

                    // A action termina em redirect (painel, administração ou
                    // login): aí o botão segue girando até a tela trocar — se
                    // voltasse antes, um segundo clique iria com o token já
                    // gasto e daria "link inválido" por cima do sucesso. Por
                    // isso nada de `onFinish`, que roda também no redirect. O
                    // botão volta quando o servidor recusa (o link morreu entre
                    // abrir e clicar, e a página já volta como "Link
                    // indisponível") ou quando o pedido nem chega (rede fora,
                    // deploy novo): aí a pessoa pode tentar de novo.
                    void runAction(() => confirmEmail({ token }), {
                        onSuccess: () => setConfirming(false),
                        onError: () => setConfirming(false),
                        onNetworkError: () => setConfirming(false),
                    });
                }}
            >
                {!confirming && <MailCheck className="size-5" aria-hidden />}
                Confirmar e-mail
            </Button>
        </div>
    );
}
