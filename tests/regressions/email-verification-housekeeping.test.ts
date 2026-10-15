import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as archiveDoneCardsCron } from '@/app/api/cron/archive-done-cards/route';
import { config } from '@/server/config';
import { db } from '@/server/db';
import { emailVerifications, users } from '@/server/db/schema';
import { sentMail } from '@/server/mail/mailer';
import {
    confirmEmailVerification,
    previewEmailVerification,
    sendEmailVerification,
} from '@/server/services/email-verification';
import { createUser } from '../support/factories';

/**
 * Regressão da revisão do painel de administração: a faxina noturna não
 * apagava os pedidos de confirmação de e-mail vencidos.
 *
 * `pruneExpiredEmailVerifications` existia, com o comentário "faxina noturna
 * (cron de arquivamento)", mas nem o cron nem o `npm run archive-done` a
 * chamavam. O teste do serviço a chamava na mão e não tinha como perceber. A
 * validade não sofria (pedido vencido é recusado pela data), mas a linha
 * ficava no banco para sempre, com o hash do token e o e-mail da época, que a
 * conta pode já ter trocado.
 *
 * Por isso os casos passam pela porta que roda em produção: a rota do cron.
 */
const NOW = new Date('2026-10-14T15:00:00Z');
const VALIDITY_MS = config.admin.emailVerificationMinutes * 60_000;

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

/** O token cru só existe no e-mail — como na vida real, ele sai de lá. */
function lastToken(): string {
    const match = /\/verify-email\/([A-Za-z0-9_-]+)/.exec(sentMail.at(-1)?.text ?? '');

    if (!match?.[1]) throw new Error('nenhum link de confirmação no último e-mail');

    return match[1];
}

async function pending(): Promise<{ userId: number; email: string }[]> {
    return db
        .select({ userId: emailVerifications.userId, email: emailVerifications.email })
        .from(emailVerifications)
        .orderBy(emailVerifications.userId);
}

describe('a faxina noturna dos pedidos de confirmação de e-mail', () => {
    it('apaga o pedido vencido, e com ele o e-mail que a conta já trocou', async () => {
        const ana = await createUser({ email: 'ana@example.com' });

        await sendEmailVerification(ana, NOW);

        // A troca de e-mail no perfil, sem pedir outro link. Direto no banco:
        // o que importa aqui é a linha que fica para trás, não o caminho da
        // troca.
        await db.update(users).set({ email: 'ana.nova@example.com' }).where(eq(users.id, ana.id));

        vi.setSystemTime(new Date(NOW.getTime() + VALIDITY_MS + 60_000));

        await nightlyCron('?dry-run=1');
        expect(await pending(), 'o dry-run não apaga nada').toEqual([{ userId: ana.id, email: 'ana@example.com' }]);

        await nightlyCron();
        expect(await pending()).toEqual([]);
    });

    it('apaga exatamente o que já não confirma: o que venceu agora sai, o do último segundo fica e ainda vale', async () => {
        const late = await createUser();
        const onTime = await createUser();

        await sendEmailVerification(late, NOW);
        const lateToken = lastToken();

        const oneSecondLater = new Date(NOW.getTime() + 1000);

        vi.setSystemTime(oneSecondLater);
        await sendEmailVerification(onTime, oneSecondLater);
        const onTimeToken = lastToken();

        // O prazo do primeiro termina agora; o do segundo, daqui a um segundo.
        // A faxina e a validade usam o mesmo corte: o cron nunca encurta o
        // prazo que o e-mail prometeu.
        const deadline = new Date(NOW.getTime() + VALIDITY_MS);

        vi.setSystemTime(deadline);
        expect(await previewEmailVerification(lateToken, deadline)).toBeNull();

        await nightlyCron();

        expect((await pending()).map((row) => row.userId)).toEqual([onTime.id]);
        expect(await confirmEmailVerification(onTimeToken, deadline)).toEqual({
            userId: onTime.id,
            becameNativeAdmin: false,
        });
    });
});
