import 'server-only';

import { and, asc, eq, gt, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { dayKey, endOfAppDay, startOfAppDay, toAppIso } from '@/lib/timezone';
import { config } from '@/server/config';
import { db } from '@/server/db';
import { users, type UserRow } from '@/server/db/schema';
import { digestMessage, formatRunDate } from '@/server/mail/daily-digest';
import { mailerName, sendMail } from '@/server/mail/mailer';
import { isDigestEmpty, taskDigestFor, type TaskDigest } from '@/server/services/task-digest';
import { MAX_ID } from '@/server/validation';

/**
 * O resumo diário por e-mail: o antigo comando `taskon:daily-digest` (agora
 * chamado pelo Cron da Vercel em /api/cron/daily-digest e por
 * `npm run digest`) e o que a tela Configurações › Notificações faz com ele.
 *
 * As regras, na ordem em que o disparo as aplica a cada pessoa:
 *
 *  1. só quem deixou o resumo ligado (`--force` ignora o opt-out);
 *  2. quem já recebeu HOJE (no fuso do app) é pulado — o carimbo
 *     `digest_last_sent_at` é a trava contra o envio duplo;
 *  3. resumo vazio não sai (`config.digest.skipWhenEmpty`);
 *  4. falha de um endereço não derruba o lote: conta, registra no log e segue,
 *     sem carimbar — a próxima rodada tenta de novo.
 */

export interface DailyDigestOptions {
    /** O instante do disparo — todo mundo do lote é avaliado no mesmo. */
    now?: Date;
    /**
     * Manda só para esta pessoa: id numérico ou e-mail. Ausente
     * (`null`/`undefined`) é todo mundo; presente e vazio não casa com
     * ninguém (ver `recipientFilter`).
     */
    user?: number | string | null;
    /** Ignora o opt-out e o carimbo de "já enviado hoje" (e envia mesmo vazio). */
    force?: boolean;
    /** Mostra quem receberia, sem enviar nem carimbar nada. */
    dryRun?: boolean;
}

export interface DailyDigestResult {
    sent: number;
    skipped: number;
    failed: number;
    /** O que o comando artisan imprimia, linha a linha. */
    lines: string[];
}

/** Pessoas por consulta — o `chunkById(100)` do comando original. */
const CHUNK = 100;

/**
 * O Resend aceita poucas requisições por segundo por conta (2/s no plano
 * padrão). Um lote em fila cerrada tomaria 429 a partir do terceiro e-mail.
 */
const RESEND_SPACING_MS = 600;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** O resumo pronto, enviado para a pessoa que ele descreve. Lança se o envio falhar. */
export async function sendDigestEmail(digest: TaskDigest): Promise<void> {
    await sendMail(digestMessage(digest));
}

/**
 * `--user=` / `?user=`: id numérico ou e-mail (os e-mails são gravados em
 * minúsculas).
 *
 * Opção AUSENTE é "todo mundo"; opção PRESENTE e vazia (ou só espaços) é um
 * filtro que não casa com ninguém — no artisan, `--user=` virava
 * `where email = ''`. Ler o vazio como "sem filtro" faria um
 * `?user=&force=1` digitado pela metade mandar o resumo para a base inteira,
 * opt-out incluído.
 *
 * Id grande demais para a coluna também não casa com ninguém: o Postgres
 * recusaria o parâmetro e o disparo inteiro cairia com 500, onde o MySQL do
 * legado só não achava a pessoa.
 */
function recipientFilter(only: number | string | null | undefined): SQL | undefined {
    if (only === null || only === undefined) return undefined;

    const value = String(only).trim();

    if (/^\d+$/.test(value)) {
        const id = Number(value);

        return id <= MAX_ID ? eq(users.id, id) : sql`false`;
    }

    return value === '' ? sql`false` : eq(users.email, value.toLowerCase());
}

/**
 * As opções de `npm run digest -- …`, lidas como o Symfony Console lia a
 * assinatura do comando artisan (`{--user=} {--force} {--dry-run}`):
 *
 *  - `--user=12` ou `--user 12` → só esta pessoa;
 *  - `--user=` ou `--user ""` → filtro vazio: ninguém recebe;
 *  - `--user` sem valor (no fim, ou seguido de outra opção) → como se não
 *    tivesse sido passado: todo mundo.
 *
 * A última ocorrência vale. Mora aqui, e não no script, para o teste
 * alcançá-la: importar o script o executaria.
 */
export function digestOptionsFromArgs(args: readonly string[]): Pick<DailyDigestOptions, 'user' | 'force' | 'dryRun'> {
    let user: string | null = null;

    for (const [index, arg] of args.entries()) {
        if (arg.startsWith('--user=')) {
            user = arg.slice('--user='.length);
        } else if (arg === '--user') {
            const next = args[index + 1];

            user = next !== undefined && !next.startsWith('-') ? next : null;
        }
    }

    return { user, force: args.includes('--force'), dryRun: args.includes('--dry-run') };
}

type Recipient = Pick<UserRow, 'id' | 'name' | 'email' | 'digestLastSentAt'>;

/** Os destinatários em ordem de id, cem por consulta (sem carregar a base inteira na memória). */
async function* recipients(force: boolean, only: SQL | undefined): AsyncGenerator<Recipient> {
    let lastId = 0;

    for (;;) {
        const batch = await db
            .select({ id: users.id, name: users.name, email: users.email, digestLastSentAt: users.digestLastSentAt })
            .from(users)
            .where(and(gt(users.id, lastId), force ? undefined : eq(users.dailyDigest, true), only))
            .orderBy(asc(users.id))
            .limit(CHUNK);

        yield* batch;

        if (batch.length < CHUNK) return;

        lastId = batch[batch.length - 1]!.id;
    }
}

/**
 * Reserva o envio de hoje ANTES de mandar: o carimbo só é gravado se ainda
 * não houver um do mesmo dia. É o `withoutOverlapping()` do agendador do
 * Laravel trazido para o serverless — a Vercel pode entregar o mesmo evento de
 * cron mais de uma vez, e duas execuções simultâneas passariam juntas pela
 * checagem de "já recebeu hoje". Assim só uma delas manda.
 */
async function claim(userId: number, now: Date): Promise<boolean> {
    const claimed = await db
        .update(users)
        .set({ digestLastSentAt: now })
        .where(
            and(
                eq(users.id, userId),
                or(
                    isNull(users.digestLastSentAt),
                    lt(users.digestLastSentAt, startOfAppDay(now)),
                    gt(users.digestLastSentAt, endOfAppDay(now)),
                ),
            ),
        )
        .returning({ id: users.id });

    return claimed.length > 0;
}

/** Desfaz a reserva de um envio que falhou: o carimbo volta a ser o de antes. */
async function release(userId: number, previous: Date | null, now: Date): Promise<void> {
    await db
        .update(users)
        .set({ digestLastSentAt: previous })
        .where(and(eq(users.id, userId), eq(users.digestLastSentAt, now)));
}

export async function runDailyDigest(options: DailyDigestOptions = {}): Promise<DailyDigestResult> {
    const now = options.now ?? new Date();
    const force = options.force ?? false;
    const dryRun = options.dryRun ?? false;
    const spaced = !dryRun && mailerName() === 'resend';

    const lines = [`${dryRun ? 'Simulando o resumo de ' : 'Enviando o resumo de '}${formatRunDate(now)}.`];
    let sent = 0;
    let skipped = 0;
    let failed = 0;
    let attempts = 0;

    for await (const user of recipients(force, recipientFilter(options.user))) {
        // Reenviar o mesmo resumo é pior que não enviar: quem já leu ignora,
        // quem não leu passa a ignorar. O carimbo é a trava.
        if (!force && user.digestLastSentAt && dayKey(user.digestLastSentAt) === dayKey(now)) {
            skipped++;
            lines.push(`  – ${user.email} já recebeu hoje`);

            continue;
        }

        const digest = await taskDigestFor(user, now);

        if (isDigestEmpty(digest) && config.digest.skipWhenEmpty && !force) {
            skipped++;
            lines.push(`  – ${user.email} nada a relatar`);

            continue;
        }

        const summary = `${digest.overdue.length} vencida(s), ${digest.today.length} hoje, ${digest.upcoming.length} à frente`;

        if (dryRun) {
            sent++;
            lines.push(`  ? ${user.email} ${summary}`);

            continue;
        }

        let claimed = false;

        try {
            if (!force) {
                claimed = await claim(user.id, now);

                if (!claimed) {
                    skipped++;
                    lines.push(`  – ${user.email} já recebeu hoje`);

                    continue;
                }
            }

            if (spaced && attempts > 0) await sleep(RESEND_SPACING_MS);

            attempts++;
            await sendDigestEmail(digest);

            // Com --force não houve reserva: o carimbo vem depois do envio.
            if (force) await db.update(users).set({ digestLastSentAt: now }).where(eq(users.id, user.id));

            sent++;
            lines.push(`  ✓ ${user.email} ${summary}`);
        } catch (error) {
            // Um endereço recusado pelo Resend não pode derrubar a fila
            // inteira — o carimbo fica como estava e a próxima rodada tenta de
            // novo.
            if (claimed) await release(user.id, user.digestLastSentAt, now).catch(() => undefined);

            failed++;
            lines.push(`  ✗ ${user.email} ${errorMessage(error)}`);
            console.error('Falha ao enviar o resumo diário', { user_id: user.id, error });
        }
    }

    lines.push('', `Enviados: ${sent}`, `Ignorados: ${skipped}`);

    if (failed > 0) lines.push(`Falhas: ${failed}`);

    return { sent, skipped, failed, lines };
}

/* -------------------------------------------------------------------------- */
/* Configurações › Notificações                                                */
/* -------------------------------------------------------------------------- */

/** O que o e-mail de hoje diria, em números. */
export interface DigestPreview {
    overdue: number;
    today: number;
    upcoming: number;
    completed: number;
    open: number;
}

export interface NotificationSettingsData {
    dailyDigest: boolean;
    /** Último envio automático bem-sucedido (o de teste não conta). */
    lastSentAt: string | null;
    /** Horário do disparo ("07:00"), no fuso do app. */
    sendAt: string;
    horizonDays: number;
    preview: DigestPreview;
}

/**
 * A tela de notificações. A prévia mostra o que o próximo resumo diria HOJE.
 * Sem ela a tela seria um interruptor sem contexto — e ninguém liga um alerta
 * sem saber o que ele vai gritar.
 */
export async function notificationSettingsFor(
    user: Pick<UserRow, 'id' | 'name' | 'email' | 'dailyDigest' | 'digestLastSentAt'>,
    now: Date = new Date(),
): Promise<NotificationSettingsData> {
    const digest = await taskDigestFor(user, now);

    return {
        dailyDigest: user.dailyDigest,
        lastSentAt: toAppIso(user.digestLastSentAt),
        sendAt: config.digest.at,
        horizonDays: config.digest.horizonDays,
        preview: {
            overdue: digest.overdue.length,
            today: digest.today.length,
            upcoming: digest.upcoming.length,
            completed: digest.completed.length,
            open: digest.openCount,
        },
    };
}

/** Liga ou desliga o resumo diário da pessoa. */
export async function setDailyDigest(user: Pick<UserRow, 'id'>, enabled: boolean): Promise<void> {
    await db.update(users).set({ dailyDigest: enabled }).where(eq(users.id, user.id));
}

/**
 * Manda o resumo agora, para a própria pessoa — o botão "Enviar agora para
 * mim".
 *
 * Não carimba digest_last_sent_at de propósito: o teste não pode fazer o envio
 * real do dia ser pulado.
 */
export async function sendDigestNow(user: Pick<UserRow, 'id' | 'name' | 'email'>, now: Date = new Date()): Promise<void> {
    await sendDigestEmail(await taskDigestFor(user, now));
}
