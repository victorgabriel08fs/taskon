import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as archiveDoneCardsCron } from '@/app/api/cron/archive-done-cards/route';
import { config } from '@/server/config';
import { db } from '@/server/db';
import { emailVerifications } from '@/server/db/schema';
import { sendEmailVerification } from '@/server/services/email-verification';
import { createUser } from '../support/factories';

/**
 * Revisão (lente: testes) — a faxina dos pedidos de confirmação de e-mail.
 *
 * `pruneExpiredEmailVerifications` diz no próprio comentário que é a "faxina
 * noturna (cron de arquivamento)", e o BOAS_PRATICAS (seção 8) promete que o
 * que vence é apagado pelo cron noturno. O teste existente chama a função na
 * mão; este passa pela porta que roda de verdade em produção: a rota do cron.
 */
vi.mock('next/cache', () => ({ refresh: vi.fn() }));

const NOW = new Date('2026-10-14T15:00:00Z');

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

async function nightlyCron(query = ''): Promise<void> {
    const response = await archiveDoneCardsCron(new Request(`http://taskon.test/api/cron/archive-done-cards${query}`));

    expect(response.status).toBe(200);
}

describe('a faxina noturna', () => {
    it('apaga o pedido de confirmação vencido e mantém o que ainda vale', async () => {
        const expired = await createUser();
        const valid = await createUser();

        await sendEmailVerification(expired, NOW);

        // Passou o prazo do primeiro; o segundo acabou de ser pedido.
        const later = new Date(NOW.getTime() + (config.admin.emailVerificationMinutes + 1) * 60_000);

        vi.setSystemTime(later);
        await sendEmailVerification(valid, later);

        await nightlyCron('?dry-run=1');
        expect(await db.$count(emailVerifications), 'o dry-run não apaga nada').toBe(2);

        await nightlyCron();

        expect(await db.select({ userId: emailVerifications.userId }).from(emailVerifications)).toEqual([
            { userId: valid.id },
        ]);
    });
});
