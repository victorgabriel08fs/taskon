import 'server-only';

import { config } from '@/server/config';
import { escapeHtml } from '@/server/mail/mailer';

/**
 * O e-mail com o link de confirmação de endereço — a prova de que a caixa de
 * entrada é de quem tem a conta. É essa prova que ativa o admin nativo (ver
 * src/server/policies/admin.ts): o cadastro não verifica e-mail, e sem ela
 * qualquer um que criasse a conta com o endereço da lista viraria admin.
 *
 * Mesmo visual do de redefinição de senha (src/server/mail/password-reset.ts)
 * e pelos mesmos motivos: HTML de e-mail é HTML de 2005, com tabelas, largura
 * fixa e estilo inline, e sem imagem remota.
 *
 * Todo texto que veio de gente (nome, e-mail) passa por escapeHtml: um nome
 * como "<a href=…>" não pode virar link no e-mail.
 */

const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export interface EmailVerificationMail {
    subject: string;
    html: string;
    text: string;
}

/** A validade como a pessoa a leria: "24 horas", não "1440 minutos". */
function duration(minutes: number): string {
    if (minutes % 60 !== 0) return `${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`;

    const hours = minutes / 60;

    return `${hours} ${hours === 1 ? 'hora' : 'horas'}`;
}

export function emailVerificationMail({
    name,
    email,
    url,
    expiresInMinutes,
}: {
    name: string;
    email: string;
    url: string;
    expiresInMinutes: number;
}): EmailVerificationMail {
    // Só o primeiro nome, como no "Bom dia, Victor." do resumo.
    const firstName = name.trim().split(/\s+/u)[0] || name;
    const validity = duration(expiresInMinutes);
    const app = escapeHtml(config.appName);
    const address = escapeHtml(email);
    const href = escapeHtml(url);

    const subject = `Confirme seu e-mail no ${config.appName}`;

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <meta name="color-scheme" content="light">
    <title>Confirmar e-mail</title>
</head>
<body style="margin:0; padding:0; width:100%; background-color:#eef0f5; -webkit-font-smoothing:antialiased;">

<!-- Prévia que aparece na lista de e-mails, ao lado do assunto. -->
<div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent; height:0; width:0;">
    Confirme que ${address} é seu. O link vale por ${validity}.
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
                    Olá, ${escapeHtml(firstName)}.
                </p>
                <p style="margin:6px 0 0; font-family:${FONT}; font-size:14px; line-height:1.5; color:rgba(255,255,255,0.82);">
                    Falta só confirmar que este e-mail é seu.
                </p>
            </td>
        </tr>

        <tr>
            <td style="padding:28px 32px 0; font-family:${FONT}; font-size:15px; line-height:1.6; color:#334155;">
                Clique no botão abaixo para confirmar o endereço
                <strong style="color:#0f172a;">${address}</strong> na sua conta. O link vale por
                <strong style="color:#0f172a;">${validity}</strong> e só funciona uma vez.
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
                                Confirmar e-mail
                            </a>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>

        <!-- Quem pede o link é a conta logada: se não foi o dono da caixa de
             entrada, alguém criou uma conta com o endereço dele. -->
        <tr>
            <td style="padding:24px 32px 0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f8fafc; border:1px solid #e6e9ef; border-radius:12px;">
                    <tr>
                        <td style="padding:14px 16px; font-family:${FONT}; font-size:13px; line-height:1.55; color:#475569;">
                            Não foi você que pediu? Alguém pode ter criado uma conta com o seu endereço.
                            Não clique no botão — e, se quiser assumir a conta, use "Esqueci a senha"
                            na tela de entrada.
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
        `Olá, ${firstName}.`,
        '',
        `Para confirmar o endereço ${email} na sua conta do ${config.appName}, abra o link abaixo. Ele vale por ${validity} e só funciona uma vez:`,
        url,
        '',
        'Não foi você que pediu? Alguém pode ter criado uma conta com o seu endereço. Não abra o link — e, se quiser assumir a conta, use "Esqueci a senha" na tela de entrada.',
    ].join('\n');

    return { subject, html, text };
}
