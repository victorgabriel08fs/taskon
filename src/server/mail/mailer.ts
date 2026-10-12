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
    /**
     * Só o endereço de quem recebe. É por ele que se confere o destinatário
     * (o `hasTo($email)` do Laravel vira `sentMail[0].to === email`).
     */
    to: string;
    /**
     * O nome de exibição de quem recebe: o `Mail::to($user)` do Laravel
     * mandava "Nome <email>". Os drivers que entregam de verdade (smtp,
     * resend) montam o endereço com `formatAddress`; sem nome, vai só o
     * e-mail.
     */
    toName?: string | null;
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

/**
 * O nome que pode ir solto, sem aspas: só "atoms" do RFC 5322 (letras e
 * dígitos ASCII, os símbolos de `atext`) e espaços.
 */
const PLAIN_PHRASE = /^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~ ]+$/;

/**
 * "Nome <email>" seguro (RFC 5322) para o cabeçalho de destinatário.
 *
 * O nome vem de gente, então é tratado como texto hostil:
 *
 *  - quebras de linha e outros caracteres de controle viram espaço — um
 *    "\r\n" no nome seria injeção de cabeçalho;
 *  - nome que não seja só letras ASCII, dígitos, espaços e os símbolos de
 *    `atext` vai como quoted-string, com `\` e `"` escapados. Sem as aspas,
 *    vírgula separaria destinatários, ponto quebraria os parsers estritos, e
 *    um nome como "Ana <outro@dominio.com>" DESVIARIA o e-mail: o parser do
 *    nodemailer entrega no primeiro `<…>` que encontra;
 *  - acentos também vão entre aspas, a forma que o legado mandava ao Resend
 *    (o `Address::toString()` do Symfony põe todo nome entre aspas). Quem
 *    monta o cabeçalho de verdade (nodemailer, Resend) os codifica no
 *    RFC 2047;
 *  - sem nome (ou só espaços), só o e-mail.
 */
export function formatAddress(name: string | null | undefined, email: string): string {
    const address = email.trim();
    const display = (name ?? '').replace(/[\p{Cc}\s]+/gu, ' ').trim();

    if (display === '') return address;

    const phrase = PLAIN_PHRASE.test(display) ? display : `"${display.replace(/[\\"]/g, '\\$&')}"`;

    return `${phrase} <${address}>`;
}

/** Envia ou lança — quem chama decide se a falha derruba a operação. */
export async function sendMail(message: MailMessage): Promise<void> {
    const recipient = formatAddress(message.toName, message.to);

    switch (mailerName()) {
        case 'array':
            sentMail.push(message);

            return;

        case 'log':
            // Na Vercel (produção ou preview) o `log` é falha, não entrega: o
            // corpo pode carregar um link de redefinição de senha, que não
            // pode parar no log do deploy; e fingir que enviou faria o resumo
            // carimbar todo mundo como "recebeu hoje" e o "Esqueci a senha"
            // anunciar um link que nunca saiu. Lançar deixa a falha à vista.
            if (process.env.VERCEL) {
                throw new Error('E-mail não configurado neste deploy: defina RESEND_API_KEY (ou MAIL_MAILER=smtp).');
            }

            console.info(
                `[mail:log] para ${recipient} · ${message.subject}\n${message.text ?? message.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000)}`,
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
                to: recipient,
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
                to: recipient,
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
