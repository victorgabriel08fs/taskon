import 'server-only';

import { config } from '@/server/config';
import { escapeHtml } from '@/server/mail/mailer';

/**
 * O e-mail do convite para um quadro — para quem ainda não tem conta no app.
 *
 * Mesmo visual do de redefinição de senha (src/server/mail/password-reset.ts)
 * e pelos mesmos motivos: HTML de e-mail é HTML de 2005, com tabelas, largura
 * fixa e estilo inline, e sem imagem remota.
 *
 * Todo texto que veio de gente (nome de quem convidou, título do quadro) passa
 * por escapeHtml: um quadro chamado "<a href=…>" não pode virar link no e-mail.
 */

const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export interface BoardInvitationMail {
    subject: string;
    html: string;
    text: string;
}

function days(count: number): string {
    return `${count} ${count === 1 ? 'dia' : 'dias'}`;
}

export function boardInvitationMail({
    inviterName,
    boardTitle,
    role,
    url,
    expiresInDays,
}: {
    inviterName: string | null;
    boardTitle: string;
    role: 'admin' | 'member';
    url: string;
    expiresInDays: number;
}): BoardInvitationMail {
    const who = inviterName?.trim() || 'Alguém';
    const roleLabel = role === 'admin' ? 'admin' : 'membro';
    const validity = days(expiresInDays);
    const app = escapeHtml(config.appName);
    const href = escapeHtml(url);

    const subject = `${who} convidou você para o quadro "${boardTitle}" no ${config.appName}`;

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <meta name="color-scheme" content="light">
    <title>Convite para um quadro</title>
</head>
<body style="margin:0; padding:0; width:100%; background-color:#eef0f5; -webkit-font-smoothing:antialiased;">

<!-- Prévia que aparece na lista de e-mails, ao lado do assunto. -->
<div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent; height:0; width:0;">
    Crie sua conta e entre no quadro ${escapeHtml(boardTitle)}. O convite vale por ${validity}.
    &#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#eef0f5;">
<tr>
<td align="center" style="padding:28px 12px 40px;">

    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:600px; background-color:#ffffff; border-radius:18px; overflow:hidden; box-shadow:0 1px 3px rgba(15,23,42,0.08);">

        <!-- Cabeçalho: cor sólida de reserva para o Outlook, que ignora gradiente. -->
        <tr>
            <td style="background-color:#7c3aed; background-image:linear-gradient(120deg,#6d28d9 0%,#7c3aed 45%,#c026d3 100%); padding:28px 32px;">
                <div style="font-family:${FONT}; font-size:17px; font-weight:700; color:#ffffff; letter-spacing:-0.2px;">
                    ${app}
                </div>
                <p style="margin:18px 0 0; font-family:${FONT}; font-size:24px; line-height:1.25; font-weight:700; color:#ffffff;">
                    Você foi convidado para um quadro.
                </p>
                <p style="margin:6px 0 0; font-family:${FONT}; font-size:14px; line-height:1.5; color:rgba(255,255,255,0.82);">
                    ${escapeHtml(who)} quer organizar o trabalho com você.
                </p>
            </td>
        </tr>

        <tr>
            <td style="padding:28px 32px 0; font-family:${FONT}; font-size:15px; line-height:1.6; color:#334155;">
                <strong style="color:#0f172a;">${escapeHtml(who)}</strong> convidou você para entrar como
                <strong style="color:#0f172a;">${roleLabel}</strong> no quadro
                <strong style="color:#0f172a;">${escapeHtml(boardTitle)}</strong>.
                Crie sua conta (leva 20 segundos) ou entre com a que você já tem — o convite vale por
                <strong style="color:#0f172a;">${validity}</strong>.
            </td>
        </tr>

        <!-- Chamada para ação -->
        <tr>
            <td align="center" style="padding:26px 28px 4px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                        <td align="center" style="background-color:#7c3aed; border-radius:10px;">
                            <a href="${href}"
                               style="display:inline-block; padding:13px 30px; font-family:${FONT}; font-size:15px; font-weight:600; color:#ffffff; text-decoration:none;">
                                Aceitar convite
                            </a>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>

        <tr>
            <td style="padding:24px 32px 0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f8fafc; border:1px solid #e6e9ef; border-radius:12px;">
                    <tr>
                        <td style="padding:14px 16px; font-family:${FONT}; font-size:13px; line-height:1.55; color:#475569;">
                            Não esperava este convite? Pode ignorar este e-mail — sem aceitar, ninguém
                            cria conta nem acessa nada em seu nome.
                        </td>
                    </tr>
                </table>
            </td>
        </tr>

        <tr>
            <td style="padding:26px 32px 30px;">
                <div style="height:1px; background-color:#e6e9ef; font-size:0; line-height:0;">&nbsp;</div>
                <p style="margin:16px 0 0; font-family:${FONT}; font-size:12px; line-height:1.6; color:#94a3b8;">
                    O botão não funcionou? Copie e cole este endereço no navegador:<br>
                    <a href="${href}" style="color:#7c3aed; text-decoration:underline; word-break:break-all;">${href}</a>
                </p>
            </td>
        </tr>
    </table>

</td>
</tr>
</table>

</body>
</html>`;

    const text = [
        `${who} convidou você para entrar como ${roleLabel} no quadro "${boardTitle}" no ${config.appName}.`,
        '',
        `Para aceitar, abra o link abaixo e crie sua conta (ou entre com a que você já tem). Ele vale por ${validity}:`,
        url,
        '',
        'Não esperava este convite? Pode ignorar este e-mail.',
    ].join('\n');

    return { subject, html, text };
}
