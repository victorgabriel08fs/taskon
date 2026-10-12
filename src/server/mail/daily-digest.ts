import 'server-only';

import { addAppDays, dayKey, wallClock } from '@/lib/timezone';
import { appUrl } from '@/server/config';
import { escapeHtml, type MailMessage } from '@/server/mail/mailer';
import { digestSections, type DigestCard, type DigestSection, type TaskDigest } from '@/server/services/task-digest';

/**
 * O resumo diário — o antigo Mailable `App\Mail\DailyDigest` mais a view
 * `resources/views/mail/daily-digest.blade.php`.
 *
 * É enviado na hora, sem fila: quem dispara já roda fora do ciclo de uma tela
 * (o Cron da Vercel, o script de linha de comando ou o botão de teste), e uma
 * fila exigiria um worker de pé só para isso.
 *
 * As datas imitam o Carbon em pt_BR que o e-mail usava (`translatedFormat`,
 * `diffForHumans`) — dia com dois dígitos, mês e dia da semana abreviados sem
 * ponto ("12 de out", "ter, 13 de out"). O `Intl` do navegador escreve "out."
 * e "ter.", então os nomes ficam aqui, por extenso.
 */

/* -------------------------------------------------------------------------- */
/* Datas no formato do Carbon pt_BR, no fuso do app                            */
/* -------------------------------------------------------------------------- */

const MONTHS = [
    'janeiro',
    'fevereiro',
    'março',
    'abril',
    'maio',
    'junho',
    'julho',
    'agosto',
    'setembro',
    'outubro',
    'novembro',
    'dezembro',
] as const;

const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'] as const;

const WEEKDAYS = [
    'domingo',
    'segunda-feira',
    'terça-feira',
    'quarta-feira',
    'quinta-feira',
    'sexta-feira',
    'sábado',
] as const;

const WEEKDAYS_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] as const;

const pad = (value: number) => String(value).padStart(2, '0');

/** As partes do dia de calendário (no fuso do app) que os formatos usam. */
function calendar(date: Date) {
    const wall = wallClock(date);
    const weekday = new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay();

    return { ...wall, weekday };
}

/** `d \d\e M` → "12 de out" (o fim do assunto). */
export function formatShortDate(date: Date): string {
    const day = calendar(date);

    return `${pad(day.day)} de ${MONTHS_SHORT[day.month - 1]}`;
}

/** `l, d \d\e F` → "segunda-feira, 12 de outubro" (o canto do cabeçalho). */
export function formatLongDate(date: Date): string {
    const day = calendar(date);

    return `${WEEKDAYS[day.weekday]}, ${pad(day.day)} de ${MONTHS[day.month - 1]}`;
}

/** `d \d\e F \à\s H:i` → "12 de outubro às 07:00" (a linha de abertura do disparo). */
export function formatRunDate(date: Date): string {
    const day = calendar(date);

    return `${pad(day.day)} de ${MONTHS[day.month - 1]} às ${pad(day.hour)}:${pad(day.minute)}`;
}

/** `H:i` → "09:05". */
function formatTime(date: Date): string {
    const wall = wallClock(date);

    return `${pad(wall.hour)}:${pad(wall.minute)}`;
}

/** `D, d \d\e M` → "ter, 13 de out". */
function formatWeekdayDate(date: Date): string {
    const day = calendar(date);

    return `${WEEKDAYS_SHORT[day.weekday]}, ${pad(day.day)} de ${MONTHS_SHORT[day.month - 1]}`;
}

/* -------------------------------------------------------------------------- */
/* diffForHumans                                                               */
/* -------------------------------------------------------------------------- */

const UNITS = [
    ['ano', 'anos'],
    ['mês', 'meses'],
    ['semana', 'semanas'],
    ['dia', 'dias'],
    ['hora', 'horas'],
    ['minuto', 'minutos'],
    ['segundo', 'segundos'],
] as const;

function daysInMonth(year: number, month: number): number {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * `$date->diffForHumans($other)` do Carbon em pt_BR: "2 dias antes",
 * "3 horas antes", "1 semana antes" — ou "… depois" quando `date` vem depois
 * de `other`.
 *
 * Reproduz as regras do PHP/Carbon, não uma aproximação:
 *
 *  - a diferença é de CALENDÁRIO, no relógio de parede do fuso do app (anos,
 *    meses, dias, horas…), como o `DateTime::diff`. Faltando dias, o PHP pega
 *    emprestado dos meses que antecedem o da data mais nova — 31/01 → 01/03
 *    dá "4 semanas", não "1 mês";
 *  - só a maior unidade aparece, truncada (2 dias e 23 h = "2 dias"); dias
 *    viram semanas de 7 em 7, como no CarbonInterval;
 *  - abaixo de um segundo, "0 segundo": no português do tradutor do Laravel
 *    zero também é singular.
 */
export function diffForHumans(date: Date, other: Date): string {
    const after = date.getTime() > other.getTime();
    const [older, newer] = after ? [other, date] : [date, other];
    const a = wallClock(older);
    const b = wallClock(newer);

    let years = b.year - a.year;
    let months = b.month - a.month;
    let days = b.day - a.day;
    let hours = b.hour - a.hour;
    let minutes = b.minute - a.minute;
    let seconds = b.second - a.second;
    let millis = newer.getMilliseconds() - older.getMilliseconds();

    if (millis < 0) {
        millis += 1000;
        seconds--;
    }

    if (seconds < 0) {
        seconds += 60;
        minutes--;
    }

    if (minutes < 0) {
        minutes += 60;
        hours--;
    }

    if (hours < 0) {
        hours += 24;
        days--;
    }

    if (months < 0) {
        months += 12;
        years--;
    }

    let year = b.year;
    let month = b.month;

    while (days < 0) {
        month--;

        if (month < 1) {
            month = 12;
            year--;
        }

        days += daysInMonth(year, month);
        months--;
    }

    if (months < 0) {
        months += 12;
        years--;
    }

    const values = [years, months, Math.floor(days / 7), days % 7, hours, minutes, seconds];
    const index = values.findIndex((value) => value > 0);
    const count = index === -1 ? 0 : values[index]!;
    const [singular, plural] = UNITS[index === -1 ? UNITS.length - 1 : index]!;

    return `${count} ${count <= 1 ? singular : plural} ${after ? 'depois' : 'antes'}`;
}

/* -------------------------------------------------------------------------- */
/* Assunto, cabeçalhos e corpo                                                 */
/* -------------------------------------------------------------------------- */

const plural = (count: number, singular: string, many: string) => `${count} ${count === 1 ? singular : many}`;

/**
 * O assunto é a parte que mais gente lê. Ele carrega o número que importa em
 * vez de repetir "Resumo diário" todo dia.
 */
export function digestSubject(digest: TaskDigest): string {
    const overdue = digest.overdue.length;
    const today = digest.today.length;
    const upcoming = digest.upcoming.length;

    const subject =
        overdue > 0
            ? `⏰ ${plural(overdue, 'tarefa vencida', 'tarefas vencidas')}`
            : today > 0
              ? `📌 ${plural(today, 'tarefa vence hoje', 'tarefas vencem hoje')}`
              : upcoming > 0
                ? `📅 ${plural(upcoming, 'tarefa no radar', 'tarefas no radar')}`
                : '✅ Você fechou o dia sem pendências';

    return `${subject} · ${formatShortDate(digest.now)}`;
}

/**
 * Cabeçalho padrão (RFC 8058) que faz o Gmail mostrar "Cancelar inscrição" ao
 * lado do remetente. Sem ele, quem quer sair marca como spam — e queima a
 * reputação do domínio no Resend.
 */
export function digestHeaders(): Record<string, string> {
    return { 'List-Unsubscribe': `<${appUrl('/settings/notifications')}>` };
}

/**
 * O prazo como a linha do card mostra: "venceu 2 dias antes", "hoje às 14:00",
 * "amanhã às 09:00" ou "ter, 13 de out às 18:00".
 *
 * "venceu" compara com o instante, não com o dia: um card de hoje às 10:00
 * aparece em "Vencem hoje" (a seção é decidida pelo dia) e, às 11:00, diz
 * "venceu 1 hora antes".
 */
export function dueLabel(due: Date, now: Date): string {
    if (due.getTime() < now.getTime()) {
        return `venceu ${diffForHumans(due, now)}`;
    }

    if (dayKey(due) === dayKey(now)) {
        return `hoje às ${formatTime(due)}`;
    }

    if (dayKey(due) === dayKey(addAppDays(now, 1))) {
        return `amanhã às ${formatTime(due)}`;
    }

    return `${formatWeekdayDate(due)} às ${formatTime(due)}`;
}

/** O primeiro nome — o `Str::before($name, ' ')` do Laravel. */
function firstName(name: string): string {
    return name.split(' ')[0];
}

const cardUrl = (card: DigestCard) => appUrl(`/boards/${card.boardId}/cards/${card.id}`);

/** Cor da borda e do fundo de cada seção. */
const TONES: Record<DigestSection['tone'], { bar: string; chip: string; text: string }> = {
    danger: { bar: '#dc2626', chip: '#fef2f2', text: '#b91c1c' },
    warning: { bar: '#d97706', chip: '#fffbeb', text: '#b45309' },
    neutral: { bar: '#7c3aed', chip: '#f5f3ff', text: '#6d28d9' },
};

const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** Prévia que aparece na lista de e-mails, ao lado do assunto. */
function preheader(digest: TaskDigest): string {
    if (digest.overdue.length > 0) return `${digest.overdue.length} tarefa(s) passaram do prazo. Vamos limpar isso?`;
    if (digest.today.length > 0) return 'O que precisa da sua atenção hoje.';

    return 'Suas próximas entregas no Taskon.';
}

/** A frase sob o "Bom dia" — a mesma escada de urgência do assunto. */
function intro(digest: TaskDigest): string {
    if (digest.overdue.length > 0) return 'Tem coisa passando do prazo — comecemos por elas.';
    if (digest.today.length > 0) return 'Seu dia tem entregas marcadas. Aqui estão.';
    if (digest.upcoming.length > 0) return 'Nada vence hoje. Um bom dia para adiantar o que vem aí.';

    return 'Nenhuma pendência no radar. Aproveite.';
}

function stats(digest: TaskDigest) {
    return [
        { label: 'Vencidas', value: digest.overdue.length, color: '#dc2626' },
        { label: 'Hoje', value: digest.today.length, color: '#d97706' },
        { label: 'Em aberto', value: digest.openCount, color: '#7c3aed' },
    ];
}

/** Quantos concluídos o rodapé verde lista. */
const COMPLETED_SHOWN = 5;

/*
 * HTML de e-mail é HTML de 2005 de propósito: tabelas, largura fixa e todo
 * estilo inline. Gmail, Outlook e afins descartam <style> externo, flexbox e
 * boa parte de CSS moderno — o que sobra é isto. Nada de imagem remota
 * também: quase todo cliente bloqueia por padrão e o layout cairia.
 *
 * Todo texto que veio de gente (nome, título de card, de quadro e de lista)
 * passa por `escapeHtml` — o `{{ }}` do Blade fazia isso sozinho.
 */
export function digestHtml(digest: TaskDigest): string {
    const { now } = digest;
    const sections = digestSections(digest);
    const dashboardUrl = appUrl('/dashboard');
    const settingsUrl = appUrl('/settings/notifications');

    const scoreboard = stats(digest)
        .map(
            (stat) => `
                            <td width="33.33%" align="center" style="padding:0 4px;">
                                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f8fafc; border:1px solid #e6e9ef; border-radius:12px;">
                                    <tr>
                                        <td align="center" style="padding:14px 8px;">
                                            <div style="font-family:${FONT}; font-size:26px; font-weight:700; line-height:1; color:${stat.value > 0 ? stat.color : '#94a3b8'};">
                                                ${stat.value}
                                            </div>
                                            <div style="margin-top:5px; font-family:${FONT}; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.6px; color:#64748b;">
                                                ${stat.label}
                                            </div>
                                        </td>
                                    </tr>
                                </table>
                            </td>`,
        )
        .join('');

    // Seções de prazo. A faixa colorida à esquerda de cada card é um <td> com
    // largura fixa: aguenta o que border-left não aguenta no Outlook.
    const sectionRows = sections
        .map((section) => {
            const tone = TONES[section.tone];

            const cards = section.cards
                .map(
                    (card) => `
            <tr>
                <td style="padding:10px 28px 0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${tone.chip}; border-radius:10px;">
                        <tr>
                            <td width="4" style="width:4px; background-color:${tone.bar}; border-radius:10px 0 0 10px;">&nbsp;</td>
                            <td style="padding:12px 14px;">
                                <a href="${escapeHtml(cardUrl(card))}"
                                   style="font-family:${FONT}; font-size:15px; font-weight:600; line-height:1.35; color:#0f172a; text-decoration:none;">
                                    ${escapeHtml(card.title)}
                                </a>
                                <div style="margin-top:4px; font-family:${FONT}; font-size:12px; line-height:1.5; color:#64748b;">
                                    <span style="color:${tone.text}; font-weight:600;">${escapeHtml(card.dueAt ? dueLabel(card.dueAt, now) : '')}</span>
                                    &nbsp;·&nbsp; ${escapeHtml(card.boardTitle)} &nbsp;›&nbsp; ${escapeHtml(card.listTitle)}
                                </div>
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>`,
                )
                .join('');

            const more =
                section.total > section.cards.length
                    ? `
            <tr>
                <td style="padding:8px 28px 0; font-family:${FONT}; font-size:12px; color:#94a3b8;">
                    e mais ${section.total - section.cards.length} nesta seção
                </td>
            </tr>`
                    : '';

            return `
            <tr>
                <td style="padding:22px 28px 0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                            <td style="font-family:${FONT}; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.8px; color:${tone.text};">
                                ${escapeHtml(section.title)}
                            </td>
                            <td align="right" style="font-family:${FONT}; font-size:12px; font-weight:600; color:#94a3b8;">
                                ${section.total}
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>${cards}${more}`;
        })
        .join('');

    // Concluídas: fecha o e-mail com o que já saiu do caminho.
    const completed =
        digest.completed.length > 0
            ? `
        <tr>
            <td style="padding:24px 28px 0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f0fdf4; border:1px solid #dcfce7; border-radius:12px;">
                    <tr>
                        <td style="padding:14px 16px; font-family:${FONT};">
                            <div style="font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.8px; color:#15803d;">
                                Concluídas nas últimas 24 h · ${digest.completed.length}
                            </div>${digest.completed
                                .slice(0, COMPLETED_SHOWN)
                                .map(
                                    (card) => `
                            <div style="margin-top:8px; font-size:14px; line-height:1.4; color:#166534;">
                                <span style="color:#22c55e;">&#10003;</span>
                                <span style="text-decoration:line-through; opacity:0.75;">${escapeHtml(card.title)}</span>
                            </div>`,
                                )
                                .join('')}
                        </td>
                    </tr>
                </table>
            </td>
        </tr>`
            : '';

    // A <div> escondida logo no começo do <body> é a prévia que aparece na
    // lista de e-mails, ao lado do assunto. No cabeçalho, o gradiente é
    // background-image com cor sólida de reserva para o Outlook, que ignora
    // gradiente e ficaria com texto branco no branco. Depois vêm o placar, as
    // seções de prazo, os concluídos e a chamada para ação.
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <meta name="color-scheme" content="light">
    <title>Resumo do dia</title>
</head>
<body style="margin:0; padding:0; width:100%; background-color:#eef0f5; -webkit-font-smoothing:antialiased;">

<div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent; height:0; width:0;">
    ${preheader(digest)}
    &#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#eef0f5;">
<tr>
<td align="center" style="padding:28px 12px 40px;">

    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:600px; background-color:#ffffff; border-radius:18px; overflow:hidden; box-shadow:0 1px 3px rgba(15,23,42,0.08);">

        <tr>
            <td style="background-color:#7c3aed; background-image:linear-gradient(120deg,#6d28d9 0%,#7c3aed 45%,#c026d3 100%); padding:28px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                        <td style="font-family:${FONT}; font-size:17px; font-weight:700; color:#ffffff; letter-spacing:-0.2px;">
                            Taskon
                        </td>
                        <td align="right" style="font-family:${FONT}; font-size:12px; color:rgba(255,255,255,0.75);">
                            ${formatLongDate(now)}
                        </td>
                    </tr>
                </table>

                <p style="margin:18px 0 0; font-family:${FONT}; font-size:24px; line-height:1.25; font-weight:700; color:#ffffff;">
                    Bom dia, ${escapeHtml(firstName(digest.user.name))}.
                </p>
                <p style="margin:6px 0 0; font-family:${FONT}; font-size:14px; line-height:1.5; color:rgba(255,255,255,0.82);">
                    ${intro(digest)}
                </p>
            </td>
        </tr>

        <tr>
            <td style="padding:22px 24px 6px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>${scoreboard}
                    </tr>
                </table>
            </td>
        </tr>
${sectionRows}${completed}

        <tr>
            <td align="center" style="padding:28px 28px 4px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                        <td align="center" style="background-color:#7c3aed; border-radius:10px;">
                            <a href="${escapeHtml(dashboardUrl)}"
                               style="display:inline-block; padding:13px 30px; font-family:${FONT}; font-size:15px; font-weight:600; color:#ffffff; text-decoration:none;">
                                Abrir o painel
                            </a>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>

        <tr>
            <td style="padding:26px 28px 30px;">
                <div style="height:1px; background-color:#e6e9ef; font-size:0; line-height:0;">&nbsp;</div>
                <p style="margin:16px 0 0; font-family:${FONT}; font-size:12px; line-height:1.6; color:#94a3b8;">
                    Você recebe este resumo uma vez por dia porque tem cards atribuídos no Taskon.
                    <a href="${escapeHtml(settingsUrl)}" style="color:#7c3aed; text-decoration:underline;">Prefere não receber?</a>
                </p>
            </td>
        </tr>
    </table>

</td>
</tr>
</table>

</body>
</html>
`;
}

/**
 * A versão em texto puro, a parte `text/plain` do e-mail: cliente que não
 * mostra HTML (e filtro de spam que desconfia de e-mail só com HTML) recebe o
 * mesmo conteúdo, na mesma ordem.
 */
export function digestText(digest: TaskDigest): string {
    const { now } = digest;
    const lines: string[] = [
        `Taskon · ${formatLongDate(now)}`,
        '',
        `Bom dia, ${firstName(digest.user.name)}.`,
        intro(digest),
        '',
        stats(digest)
            .map((stat) => `${stat.label}: ${stat.value}`)
            .join(' · '),
    ];

    for (const section of digestSections(digest)) {
        lines.push('', `${section.title.toUpperCase()} (${section.total})`);

        for (const card of section.cards) {
            lines.push(
                `- ${card.title}`,
                `  ${card.dueAt ? dueLabel(card.dueAt, now) : ''} · ${card.boardTitle} › ${card.listTitle}`,
                `  ${cardUrl(card)}`,
            );
        }

        if (section.total > section.cards.length) {
            lines.push(`e mais ${section.total - section.cards.length} nesta seção`);
        }
    }

    if (digest.completed.length > 0) {
        lines.push('', `CONCLUÍDAS NAS ÚLTIMAS 24 H · ${digest.completed.length}`);

        for (const card of digest.completed.slice(0, COMPLETED_SHOWN)) {
            lines.push(`✓ ${card.title}`);
        }
    }

    lines.push(
        '',
        `Abrir o painel: ${appUrl('/dashboard')}`,
        '',
        'Você recebe este resumo uma vez por dia porque tem cards atribuídos no Taskon.',
        `Prefere não receber? ${appUrl('/settings/notifications')}`,
    );

    return lines.join('\n');
}

/** O e-mail pronto para o `sendMail`, endereçado a quem o resumo descreve. */
export function digestMessage(digest: TaskDigest): MailMessage {
    return {
        to: digest.user.email,
        subject: digestSubject(digest),
        html: digestHtml(digest),
        text: digestText(digest),
        headers: digestHeaders(),
    };
}
