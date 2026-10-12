import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/cron/daily-digest/route';
import { addAppDays } from '@/lib/timezone';
import { db } from '@/server/db';
import { users, type BoardRow, type UserRow, type cards } from '@/server/db/schema';
import { diffForHumans, digestHeaders, digestHtml, digestSubject, digestText, dueLabel } from '@/server/mail/daily-digest';
import { sentMail } from '@/server/mail/mailer';
import {
    notificationSettingsFor,
    runDailyDigest,
    sendDigestNow,
    setDailyDigest,
} from '@/server/services/daily-digest';
import { isDigestEmpty, taskDigestFor } from '@/server/services/task-digest';
import { assign, createBoard, createCard, createList, createUser } from './support/factories';

/**
 * O antigo DailyDigestTest, mais o que o Blade e o Carbon faziam sozinhos e
 * aqui virou código nosso: assunto, datas em pt_BR, escape do HTML e a rota
 * do cron.
 *
 * O relógio fica parado numa segunda-feira, 12/10/2026, 10:00 em São Paulo.
 * `sentMail` é a caixa de saída do mailer `array` (o Mail::fake()), zerada
 * antes de cada teste.
 */
const NOW = new Date('2026-10-12T13:00:00Z');

const hoursFromNow = (hours: number) => new Date(Date.now() + hours * 3_600_000);

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

/** Um card atribuído à pessoa, num quadro de que ela é dona (ou no quadro dado). */
async function assignedCard(user: UserRow, overrides: Partial<typeof cards.$inferInsert> = {}, board?: BoardRow) {
    const list = await createList(board ?? (await createBoard(user)));
    const card = await createCard(list, overrides);
    await assign(card, user);

    return card;
}

async function reload(user: UserRow): Promise<UserRow> {
    const [row] = await db.select().from(users).where(eq(users.id, user.id));

    return row!;
}

describe('o retrato das tarefas', () => {
    it('separa os cards entre vencidos, de hoje e próximos', async () => {
        const user = await createUser();
        const board = await createBoard(user);

        await assignedCard(user, { title: 'Atrasado', dueAt: addAppDays(NOW, -2) }, board);
        await assignedCard(user, { title: 'Para hoje', dueAt: hoursFromNow(3) }, board);
        await assignedCard(user, { title: 'Semana que vem', dueAt: addAppDays(NOW, 3) }, board);
        // Fora do horizonte de 7 dias: não entra em nenhuma seção.
        await assignedCard(user, { title: 'Mês que vem', dueAt: addAppDays(NOW, 30) }, board);
        // Sem prazo: conta como aberto, mas não aparece no e-mail.
        await assignedCard(user, { title: 'Sem prazo' }, board);

        const digest = await taskDigestFor(user);

        expect(digest.overdue.map((card) => card.title)).toEqual(['Atrasado']);
        expect(digest.today.map((card) => card.title)).toEqual(['Para hoje']);
        expect(digest.upcoming.map((card) => card.title)).toEqual(['Semana que vem']);
        expect(digest.openCount).toBe(5);
    });

    it('ignora cards de outras pessoas e de quadros que a pessoa deixou', async () => {
        const user = await createUser();
        const other = await createUser();

        // Card vencido de outra pessoa, no mesmo quadro.
        const shared = await createBoard(user);
        await assignedCard(other, { dueAt: addAppDays(NOW, -1) }, shared);

        // Card atribuído ao usuário, mas num quadro do qual ele saiu.
        const left = await createBoard(other);
        await assignedCard(user, { dueAt: addAppDays(NOW, -1) }, left);

        expect(isDigestEmpty(await taskDigestFor(user))).toBe(true);
    });
});

describe('o disparo diário', () => {
    it('só manda para quem tem algo a relatar', async () => {
        const withTask = await createUser();
        await assignedCard(withTask, { dueAt: addAppDays(NOW, -1) });

        await createUser(); // sem card nenhum

        const result = await runDailyDigest();

        expect(result).toMatchObject({ sent: 1, skipped: 1, failed: 0 });
        expect(sentMail).toHaveLength(1);
        expect(sentMail[0]!.to).toBe(withTask.email);
        expect(result.lines[0]).toBe('Enviando o resumo de 12 de outubro às 10:00.');
        expect(result.lines).toContain(`  ✓ ${withTask.email} 1 vencida(s), 0 hoje, 0 à frente`);
    });

    it('respeita o opt-out', async () => {
        const user = await createUser({ dailyDigest: false });
        await assignedCard(user, { dueAt: addAppDays(NOW, -1) });

        const result = await runDailyDigest();

        expect(result.failed).toBe(0);
        expect(sentMail).toHaveLength(0);
    });

    it('não manda duas vezes no mesmo dia', async () => {
        const user = await createUser();
        await assignedCard(user, { dueAt: addAppDays(NOW, -1) });

        await runDailyDigest();
        const second = await runDailyDigest();

        expect(sentMail).toHaveLength(1);
        expect(second.lines).toContain(`  – ${user.email} já recebeu hoje`);
        expect((await reload(user)).digestLastSentAt?.toISOString()).toBe(NOW.toISOString());

        // --force existe justamente para furar a trava.
        await runDailyDigest({ force: true });
        expect(sentMail).toHaveLength(2);
    });

    it('duas rodadas ao mesmo tempo mandam um e-mail só', async () => {
        const user = await createUser();
        await assignedCard(user, { dueAt: addAppDays(NOW, -1) });

        // A Vercel pode entregar o mesmo evento de cron duas vezes.
        const results = await Promise.all([runDailyDigest(), runDailyDigest({ now: new Date(NOW.getTime() + 1) })]);

        expect(sentMail).toHaveLength(1);
        expect(results.map((result) => result.sent).sort()).toEqual([0, 1]);
        expect(results.map((result) => result.skipped).sort()).toEqual([0, 1]);
    });

    it('no dia seguinte manda de novo', async () => {
        const user = await createUser();
        await assignedCard(user, { dueAt: addAppDays(NOW, -1) });

        await runDailyDigest();
        vi.setSystemTime(addAppDays(NOW, 1));
        await runDailyDigest();

        expect(sentMail).toHaveLength(2);
    });

    it('o dry-run não envia nada', async () => {
        const user = await createUser();
        await assignedCard(user, { dueAt: addAppDays(NOW, -1) });

        const result = await runDailyDigest({ dryRun: true });

        expect(sentMail).toHaveLength(0);
        expect(result.sent).toBe(1);
        expect(result.lines[0]).toBe('Simulando o resumo de 12 de outubro às 10:00.');
        expect(result.lines).toContain(`  ? ${user.email} 1 vencida(s), 0 hoje, 0 à frente`);
        expect((await reload(user)).digestLastSentAt).toBeNull();
    });

    it('--force manda até o resumo vazio e ignora o opt-out', async () => {
        await createUser({ dailyDigest: false });

        const result = await runDailyDigest({ force: true });

        expect(result.sent).toBe(1);
        expect(sentMail[0]!.subject).toBe('✅ Você fechou o dia sem pendências · 12 de out');
    });

    it('--user escolhe uma pessoa pelo id ou pelo e-mail', async () => {
        const ana = await createUser({ email: 'ana@taskon.test' });
        const bia = await createUser({ email: 'bia@taskon.test' });
        await assignedCard(ana, { dueAt: addAppDays(NOW, -1) });
        await assignedCard(bia, { dueAt: addAppDays(NOW, -1) });

        await runDailyDigest({ user: String(bia.id) });
        expect(sentMail.map((mail) => mail.to)).toEqual(['bia@taskon.test']);

        await runDailyDigest({ user: ' ANA@taskon.test ' });
        expect(sentMail.map((mail) => mail.to)).toEqual(['bia@taskon.test', 'ana@taskon.test']);
    });

    it('uma falha não derruba o lote nem carimba o envio', async () => {
        const first = await createUser();
        const second = await createUser();
        await assignedCard(first, { dueAt: addAppDays(NOW, -1) });
        await assignedCard(second, { dueAt: addAppDays(NOW, -1) });

        // Resend sem chave: o envio lança, como uma recusa da API.
        vi.stubEnv('MAIL_MAILER', 'resend');
        vi.stubEnv('RESEND_API_KEY', '');
        const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const failed = await runDailyDigest();

        expect(failed).toMatchObject({ sent: 0, failed: 2 });
        expect(failed.lines).toContain(`  ✗ ${first.email} MAIL_MAILER=resend, mas RESEND_API_KEY está vazia.`);
        expect(failed.lines.at(-1)).toBe('Falhas: 2');
        expect(logged).toHaveBeenCalledTimes(2);
        expect((await reload(first)).digestLastSentAt).toBeNull();

        // A próxima rodada tenta de novo.
        vi.unstubAllEnvs();
        const retried = await runDailyDigest();

        expect(retried).toMatchObject({ sent: 2, failed: 0 });
        expect(sentMail).toHaveLength(2);
    }, 10_000);
});

describe('Configurações › Notificações', () => {
    it('mostra a prévia do próximo resumo', async () => {
        const user = await createUser();
        await assignedCard(user, { dueAt: addAppDays(NOW, -1) });

        const settings = await notificationSettingsFor(await reload(user));

        expect(settings).toEqual({
            dailyDigest: true,
            lastSentAt: null,
            sendAt: '07:00',
            horizonDays: 7,
            preview: { overdue: 1, today: 0, upcoming: 0, completed: 0, open: 1 },
        });
    });

    it('mostra o último envio no fuso do app', async () => {
        const user = await createUser({ digestLastSentAt: new Date('2026-10-12T10:00:05Z') });

        const settings = await notificationSettingsFor(user);

        expect(settings.lastSentAt).toBe('2026-10-12T07:00:05-03:00');
    });

    it('a chave persiste', async () => {
        const user = await createUser();

        await setDailyDigest(user, false);

        expect((await reload(user)).dailyDigest).toBe(false);
    });

    it('o envio de teste não consome o dia', async () => {
        const user = await createUser();
        await assignedCard(user, { dueAt: addAppDays(NOW, -1) });

        await sendDigestNow(user);
        expect(sentMail).toHaveLength(1);
        expect((await reload(user)).digestLastSentAt).toBeNull();

        // O envio automático do dia continua de pé.
        await runDailyDigest();
        expect(sentMail).toHaveLength(2);
    });
});

describe('o e-mail', () => {
    it('leva no assunto o número que importa', async () => {
        const user = await createUser();
        const board = await createBoard(user);

        expect(digestSubject(await taskDigestFor(user))).toBe('✅ Você fechou o dia sem pendências · 12 de out');

        await assignedCard(user, { dueAt: addAppDays(NOW, 2) }, board);
        await assignedCard(user, { dueAt: addAppDays(NOW, 3) }, board);
        expect(digestSubject(await taskDigestFor(user))).toBe('📅 2 tarefas no radar · 12 de out');

        await assignedCard(user, { dueAt: hoursFromNow(1) }, board);
        expect(digestSubject(await taskDigestFor(user))).toBe('📌 1 tarefa vence hoje · 12 de out');

        await assignedCard(user, { dueAt: addAppDays(NOW, -1) }, board);
        expect(digestSubject(await taskDigestFor(user))).toBe('⏰ 1 tarefa vencida · 12 de out');

        await assignedCard(user, { dueAt: addAppDays(NOW, -4) }, board);
        expect(digestSubject(await taskDigestFor(user))).toBe('⏰ 2 tarefas vencidas · 12 de out');

        // Dia com dois dígitos, como o `d` do Carbon.
        vi.setSystemTime(new Date('2026-11-05T12:00:00Z'));
        expect(digestSubject(await taskDigestFor(user))).toMatch(/ · 05 de nov$/);
    });

    it('tem o cabeçalho de descadastro e o texto puro', async () => {
        const user = await createUser({ name: 'Ana Souza' });
        await assignedCard(user, { title: 'Revisar contrato', dueAt: addAppDays(NOW, -2) });

        await runDailyDigest();

        const [mail] = sentMail;

        expect(mail!.headers).toEqual({ 'List-Unsubscribe': '<http://taskon.test/settings/notifications>' });
        expect(digestHeaders()).toEqual(mail!.headers);
        expect(mail!.text).toContain('Bom dia, Ana.');
        expect(mail!.text).toContain('- Revisar contrato');
        expect(mail!.text).toContain('venceu 2 dias antes');
    });

    it('monta o HTML com links absolutos e escapa o que veio de gente', async () => {
        const user = await createUser({ name: 'Ana <b>Souza</b>' });
        const board = await createBoard(user, { title: 'Quadro & Cia' });
        const card = await assignedCard(user, { title: '<script>alert(1)</script>', dueAt: addAppDays(NOW, -2) }, board);

        const html = digestHtml(await taskDigestFor(user));

        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(html).not.toContain('<script>');
        expect(html).toContain('Quadro &amp; Cia');
        expect(html).toContain('Bom dia, Ana.');
        expect(html).toContain(`href="http://taskon.test/boards/${board.id}/cards/${card.id}"`);
        expect(html).toContain('href="http://taskon.test/dashboard"');
        expect(html).toContain('segunda-feira, 12 de outubro');
        expect(html).toContain('venceu 2 dias antes');
        expect(html).toContain('1 tarefa(s) passaram do prazo. Vamos limpar isso?');
        expect(html).toContain('Tem coisa passando do prazo — comecemos por elas.');
    });

    it('corta cada seção no teto e diz quantas ficaram de fora', async () => {
        const user = await createUser();
        const board = await createBoard(user);

        for (let day = 1; day <= 11; day++) await assignedCard(user, { dueAt: addAppDays(NOW, -day) }, board);

        const digest = await taskDigestFor(user);

        expect(digestHtml(digest)).toContain('e mais 3 nesta seção');
        expect(digestText(digest)).toContain('VENCIDAS (11)');
    });

    it('lista os concluídos das últimas 24 h, até cinco', async () => {
        const user = await createUser();
        const board = await createBoard(user);

        for (let index = 1; index <= 6; index++) {
            await assignedCard(user, { title: `Feito ${index}`, completedAt: hoursFromNow(-index) }, board);
        }

        const html = digestHtml(await taskDigestFor(user));

        expect(html).toContain('Concluídas nas últimas 24 h · 6');
        expect(html).toContain('Feito 5');
        expect(html).not.toContain('Feito 6');
        expect(html).toContain('Nenhuma pendência no radar. Aproveite.');
    });

    it('escreve o prazo como o Carbon em pt_BR', () => {
        const now = new Date('2026-10-12T13:00:00Z'); // seg, 10:00 em São Paulo

        expect(dueLabel(new Date('2026-10-10T13:00:00Z'), now)).toBe('venceu 2 dias antes');
        expect(dueLabel(new Date('2026-10-12T10:00:00Z'), now)).toBe('venceu 3 horas antes');
        expect(dueLabel(new Date('2026-10-12T17:00:00Z'), now)).toBe('hoje às 14:00');
        expect(dueLabel(new Date('2026-10-13T12:05:00Z'), now)).toBe('amanhã às 09:05');
        expect(dueLabel(new Date('2026-10-17T21:00:00Z'), now)).toBe('sáb, 17 de out às 18:00');
        expect(dueLabel(new Date('2026-11-01T11:00:00Z'), now)).toBe('dom, 01 de nov às 08:00');
    });

    it('calcula a diferença como o diffForHumans do Carbon', () => {
        const at = (iso: string) => new Date(iso);

        // Saídas conferidas no Carbon 3 (pt_BR) do projeto antigo.
        expect(diffForHumans(at('2026-10-12T18:30:44.900Z'), at('2026-10-12T18:30:45.250Z'))).toBe('0 segundo antes');
        expect(diffForHumans(at('2026-10-12T18:29:00Z'), at('2026-10-12T18:30:45Z'))).toBe('1 minuto antes');
        expect(diffForHumans(at('2026-10-11T19:00:00Z'), at('2026-10-12T18:30:45Z'))).toBe('23 horas antes');
        expect(diffForHumans(at('2026-10-05T18:30:45Z'), at('2026-10-12T18:30:45Z'))).toBe('1 semana antes');
        expect(diffForHumans(at('2026-09-12T18:30:46Z'), at('2026-10-12T18:30:45Z'))).toBe('4 semanas antes');
        expect(diffForHumans(at('2026-09-12T18:30:45Z'), at('2026-10-12T18:30:45Z'))).toBe('1 mês antes');
        // 31/01 → 01/03: o PHP pega os dias emprestados de fevereiro e janeiro.
        expect(diffForHumans(at('2026-01-31T13:00:00Z'), at('2026-03-01T14:00:00Z'))).toBe('4 semanas antes');
        expect(diffForHumans(at('2024-01-01T03:00:00Z'), at('2026-10-12T18:30:45Z'))).toBe('2 anos antes');
        expect(diffForHumans(at('2026-10-12T21:30:45Z'), at('2026-10-12T18:30:45Z'))).toBe('3 horas depois');
    });
});

describe('a rota do cron', () => {
    const call = (query = '', authorization?: string) =>
        GET(
            new Request(`http://taskon.test/api/cron/daily-digest${query}`, {
                headers: authorization ? { authorization } : {},
            }),
        );

    beforeEach(() => {
        vi.spyOn(console, 'info').mockImplementation(() => undefined);
    });

    it('exige o segredo do cron', async () => {
        vi.stubEnv('CRON_SECRET', 's3cret');

        expect((await call()).status).toBe(401);
        expect((await call('', 'Bearer errado')).status).toBe(401);
        expect((await call('', 'Bearer s3cret')).status).toBe(200);
    });

    it('dispara e responde o resumo em JSON', async () => {
        const user = await createUser();
        await assignedCard(user, { dueAt: addAppDays(NOW, -1) });

        const response = await call();
        const body = (await response.json()) as { ok: boolean; sent: number; lines: string[] };

        expect(response.status).toBe(200);
        expect(body).toMatchObject({ ok: true, sent: 1, skipped: 0, failed: 0 });
        expect(sentMail).toHaveLength(1);
    });

    it('aceita dry-run, user e force na query', async () => {
        const ana = await createUser({ dailyDigest: false });
        const bia = await createUser();
        await assignedCard(ana, { dueAt: addAppDays(NOW, -1) });
        await assignedCard(bia, { dueAt: addAppDays(NOW, -1) });

        const dry = (await (await call('?dry-run=1')).json()) as { sent: number };
        expect(dry.sent).toBe(1);
        expect(sentMail).toHaveLength(0);

        await call(`?user=${ana.id}&force=1`);
        expect(sentMail.map((mail) => mail.to)).toEqual([ana.email]);
    });

    it('responde 500 quando algum envio falha', async () => {
        const user = await createUser();
        await assignedCard(user, { dueAt: addAppDays(NOW, -1) });

        vi.stubEnv('MAIL_MAILER', 'resend');
        vi.stubEnv('RESEND_API_KEY', '');
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const response = await call();

        expect(response.status).toBe(500);
        expect(await response.json()).toMatchObject({ ok: false, failed: 1 });
    });
});
