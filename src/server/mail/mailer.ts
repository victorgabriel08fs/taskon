import 'server-only';

import { config } from '@/server/config';

/**
 * Envio de e-mail com o mesmo esquema de "mailers" do Laravel, escolhido por
 * `MAIL_MAILER`:
 *
 *  - `resend` → API do Resend (produção na Vercel). É o padrão quando há
 *    `RESEND_API_KEY`;
 *  - `smtp`   → SMTP comum, ex.: o Mailpit do desenvolvimento
 *    (MAIL_HOST/MAIL_PORT);
 *  - `log`    → só escreve no console. É o padrão sem chave do Resend: nada sai
 *    para a internet por acidente;
 *  - `array`  → guarda em memória (`sentMail`). É o `Mail::fake()` dos testes.
 *
 * Lembrete do Resend: enquanto o domínio não estiver verificado no painel
 * deles, a API só aceita `onboarding@resend.dev` como remetente e só entrega
 * para o e-mail da própria conta — qualquer outro par devolve 403.
 */
export interface MailMessage {
    to: string;
    subject: string;
    html: string;
    text?: string;
    headers?: Record<string, string>;
}

export type MailerName = 'resend' | 'smtp' | 'log' | 'array';

/** Caixa de saída do driver `array` — os testes leem e limpam. */
export const sentMail: MailMessage[] = [];

export function mailerName(): MailerName {
    const configured = process.env.MAIL_MAILER?.toLowerCase();

    if (configured === 'resend' || configured === 'smtp' || configured === 'log' || configured === 'array') {
        return configured;
    }

    return process.env.RESEND_API_KEY ? 'resend' : 'log';
}

export function fromAddress(): string {
    const address = process.env.MAIL_FROM_ADDRESS || 'onboarding@resend.dev';
    const name = process.env.MAIL_FROM_NAME || config.appName;

    return `${name} <${address}>`;
}

/** Envia ou lança — quem chama decide se a falha derruba a operação. */
export async function sendMail(message: MailMessage): Promise<void> {
    switch (mailerName()) {
        case 'array':
            sentMail.push(message);

            return;

        case 'log':
            // Em produção o corpo NÃO vai para o log: ele pode carregar um link
            // de redefinição de senha, e log de deploy é lido por mais gente
            // que a dona da conta. Lá o certo é configurar o Resend.
            if (process.env.VERCEL_ENV === 'production') {
                console.warn(
                    `[mail:log] e-mail para ${message.to} ("${message.subject}") NÃO foi enviado: configure RESEND_API_KEY.`,
                );

                return;
            }

            console.info(
                `[mail:log] para ${message.to} · ${message.subject}\n${message.text ?? message.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000)}`,
            );

            return;

        case 'smtp': {
            const { createTransport } = await import('nodemailer');
            const port = Number.parseInt(process.env.MAIL_PORT ?? '1025', 10);
            const user = process.env.MAIL_USERNAME;
            const transport = createTransport({
                host: process.env.MAIL_HOST || '127.0.0.1',
                port,
                secure: port === 465,
                auth: user && user !== 'null' ? { user, pass: process.env.MAIL_PASSWORD ?? '' } : undefined,
            });

            await transport.sendMail({
                from: fromAddress(),
                to: message.to,
                subject: message.subject,
                html: message.html,
                text: message.text,
                headers: message.headers,
            });

            return;
        }

        case 'resend': {
            const apiKey = process.env.RESEND_API_KEY;

            if (!apiKey) throw new Error('MAIL_MAILER=resend, mas RESEND_API_KEY está vazia.');

            const { Resend } = await import('resend');
            const { error } = await new Resend(apiKey).emails.send({
                from: fromAddress(),
                to: message.to,
                subject: message.subject,
                html: message.html,
                text: message.text,
                headers: message.headers,
            });

            if (error) throw new Error(`Resend recusou o envio: ${error.message}`);

            return;
        }
    }
}

/** Escapa texto para dentro de HTML de e-mail. */
export function escapeHtml(value: string | null | undefined): string {
    return (value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
