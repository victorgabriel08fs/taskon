import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sentMail } from '@/server/mail/mailer';
import { EMAIL_VERIFICATION_MESSAGES, sendEmailVerification } from '@/server/services/email-verification';
import { expectHttpError } from '../support/assertions';
import { createUser } from '../support/factories';

/**
 * Revisão (lente: testes) — "um link a cada 60 s por conta e 5 por hora".
 *
 * O serviço promete (comentário de `sendEmailVerification`): "se o e-mail não
 * sai, nada muda" — o pedido que ninguém recebeu não prende a pessoa. O teste
 * original confere isso para o intervalo de 60 s; este confere para a cota da
 * hora: tentativas cujo e-mail falhou não são links, e a mensagem de erro
 * manda tentar "de novo em instantes".
 */
vi.mock('next/cache', () => ({ refresh: vi.fn() }));

const NOW = new Date('2026-10-14T15:00:00Z');

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

describe('falha no envio não gasta a cota da hora', () => {
    it('depois de cinco envios que falharam, o primeiro que dá certo sai', async () => {
        const user = await createUser();

        // O provedor de e-mail fora do ar (Resend sem chave: o mailer lança antes da rede).
        vi.stubEnv('MAIL_MAILER', 'resend');
        vi.stubEnv('RESEND_API_KEY', '');

        for (let attempt = 0; attempt < 5; attempt++) {
            vi.setSystemTime(new Date(NOW.getTime() + attempt * 1000));

            const error = await expectHttpError(sendEmailVerification(user), 500);

            expect(error.message).toBe(EMAIL_VERIFICATION_MESSAGES.mailFailed);
        }

        expect(sentMail).toHaveLength(0);

        // O provedor voltou "em instantes".
        vi.unstubAllEnvs();
        vi.setSystemTime(new Date(NOW.getTime() + 10_000));

        await expect(sendEmailVerification(user)).resolves.toEqual({ email: user.email });
        expect(sentMail).toHaveLength(1);
    });
});
