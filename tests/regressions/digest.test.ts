import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatAddress, sentMail } from '@/server/mail/mailer';
import { loadDashboard } from '@/server/queries/dashboard';
import { digestOptionsFromArgs, runDailyDigest } from '@/server/services/daily-digest';
import { assign, createBoard, createCard, createList, createUser } from '../support/factories';

/**
 * Regressões achadas na revisão da migração: filtro de usuário vazio, nome de
 * exibição do destinatário e a ordem dos títulos no progresso do painel.
 */
const NOW = new Date('2026-10-12T13:00:00Z');

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
});

afterEach(() => {
    vi.useRealTimers();
});

/** Alguém com algo a relatar: um card vencido atribuído a ela. */
async function withSomethingDue(name: string) {
    const user = await createUser({ name });
    const card = await createCard(await createList(await createBoard(user)), { dueAt: new Date('2026-10-10T15:00:00Z') });

    await assign(card, user);

    return user;
}

describe('filtro de destinatário', () => {
    it('--user= vazio não casa com ninguém, nem com --force', async () => {
        await withSomethingDue('Ana');
        await withSomethingDue('Bia');

        const result = await runDailyDigest({ now: NOW, user: '', force: true });

        expect(result.sent).toBe(0);
        expect(sentMail).toHaveLength(0);
    });

    it('só espaços também não casa com ninguém', async () => {
        await withSomethingDue('Ana');

        expect((await runDailyDigest({ now: NOW, user: '   ' })).sent).toBe(0);
    });

    it('sem --user, todo mundo com algo a relatar recebe', async () => {
        await withSomethingDue('Ana');
        await withSomethingDue('Bia');

        expect((await runDailyDigest({ now: NOW, user: null })).sent).toBe(2);
    });

    it('id acima do teto do integer não derruba o disparo', async () => {
        await withSomethingDue('Ana');

        const result = await runDailyDigest({ now: NOW, user: '3000000000' });

        expect(result.sent).toBe(0);
        expect(result.failed).toBe(0);
    });

    it('lê as opções da linha de comando como o artisan', () => {
        expect(digestOptionsFromArgs(['--user=']).user).toBe('');
        expect(digestOptionsFromArgs(['--user=12', '--force']).user).toBe('12');
        expect(digestOptionsFromArgs(['--user', 'ana@x.test', '--dry-run'])).toEqual({
            user: 'ana@x.test',
            force: false,
            dryRun: true,
        });
        expect(digestOptionsFromArgs(['--user', '--force']).user).toBeNull();
        expect(digestOptionsFromArgs([]).user).toBeNull();
    });
});

describe('endereço do destinatário', () => {
    it('vai com o nome de exibição, como o Mail::to($user)', async () => {
        await withSomethingDue('Ana Souza');

        await runDailyDigest({ now: NOW });

        expect(sentMail[0]?.toName).toBe('Ana Souza');
        expect(formatAddress(sentMail[0]?.toName, sentMail[0]!.to)).toBe(`Ana Souza <${sentMail[0]!.to}>`);
    });

    it('põe entre aspas e escapa o que poderia desviar ou injetar cabeçalho', () => {
        expect(formatAddress('Ana <outro@dominio.com>', 'ana@x.test')).toBe('"Ana <outro@dominio.com>" <ana@x.test>');
        expect(formatAddress('Souza, Ana', 'ana@x.test')).toBe('"Souza, Ana" <ana@x.test>');
        expect(formatAddress('Ana "A" \\ B', 'ana@x.test')).toBe('"Ana \\"A\\" \\\\ B" <ana@x.test>');
        expect(formatAddress('Ana\r\nBcc: x@y.z', 'ana@x.test')).toBe('"Ana Bcc: x@y.z" <ana@x.test>');
        expect(formatAddress('João', 'joao@x.test')).toBe('"João" <joao@x.test>');
        expect(formatAddress('   ', 'ana@x.test')).toBe('ana@x.test');
        expect(formatAddress(null, 'ana@x.test')).toBe('ana@x.test');
    });
});

describe('progresso por quadro no painel', () => {
    it('desempata pelo título sem diferenciar caixa nem acento, como o MariaDB', async () => {
        const user = await createUser();

        for (const title of ['Zeta', 'alfa', 'Ágil', 'beta']) {
            await createBoard(user, { title });
        }

        const { boards } = await loadDashboard(user, NOW);

        expect(boards.map((board) => board.title)).toEqual(['Ágil', 'alfa', 'beta', 'Zeta']);
    });
});
