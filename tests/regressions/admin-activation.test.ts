import { refresh } from 'next/cache';
import { isValidElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionResult } from '@/types';
import { runAction } from '@/lib/actions';
import { confirmEmail, requestEmailVerification } from '@/server/actions/email-verification';
import { hit, release } from '@/server/auth/rate-limit';
import { startSession } from '@/server/auth/session';
import { config } from '@/server/config';
import type { UserRow } from '@/server/db/schema';
import { HttpError } from '@/server/errors';
import { sentMail } from '@/server/mail/mailer';
import {
    EMAIL_VERIFICATION_MESSAGES,
    previewEmailVerification,
    sendEmailVerification,
} from '@/server/services/email-verification';
import { expectHttpError } from '../support/assertions';
import { createUser } from '../support/factories';

/**
 * Regressões achadas na revisão do painel de administração, todas na
 * confirmação de e-mail, que é o que ativa o admin nativo:
 *
 *  1. o envio que falhava gastava a cota de 5 links por hora. A vaga era
 *     contada antes do envio e não voltava quando o e-mail não saía, então
 *     cinco cliques com o Resend mal configurado (bem no primeiro deploy)
 *     prendiam a ativação por até uma hora sem nenhum link ter saído. A vaga
 *     continua reservada ANTES do envio, porque conferir antes e contar depois
 *     deixaria uma rajada simultânea passar inteira pela conferência, e agora
 *     volta quando o link não sai;
 *  2. dois pedidos simultâneos passavam juntos pelo intervalo de 60 s: saíam
 *     dois e-mails, e o link do primeiro já chegava morto. O intervalo agora é
 *     decidido na própria gravação do pedido;
 *  3. confirmar com um link que morreu com a página aberta (vencido, ou gasto
 *     em outra aba) só mostrava o toast, e a tela seguia oferecendo "Confirmar
 *     e-mail". O 404 agora re-renderiza a página, que vira "Link indisponível"
 *     com o caminho certo;
 *  4. com a rede fora (ou um deploy novo no meio), o botão "Confirmar e-mail"
 *     girava para sempre: o `runAction` não avisava quem chamou, e o botão só
 *     voltava com uma resposta do servidor. Agora há o `onNetworkError`.
 */
const jar = vi.hoisted(() => {
    const store = new Map<string, string>();

    return {
        store,
        get: (name: string) => (store.has(name) ? { name, value: store.get(name)! } : undefined),
        has: (name: string) => store.has(name),
        set: (name: string, value: string) => {
            store.set(name, value);
        },
        delete: (name: string) => {
            store.delete(name);
        },
        getAll: () => [...store].map(([name, value]) => ({ name, value })),
    };
});

vi.mock('next/headers', () => ({
    cookies: async () => jar,
    headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.41', 'user-agent': 'vitest' }),
}));
vi.mock('next/cache', () => ({ refresh: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }));

const NOW = new Date('2026-10-14T15:00:00Z');
const NATIVE_EMAIL = config.admin.nativeEmails[0]!;

beforeEach(() => {
    jar.store.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

/** Avança o relógio para `seconds` depois de NOW. */
function at(seconds: number): void {
    vi.setSystemTime(new Date(NOW.getTime() + seconds * 1000));
}

/** O provedor de e-mail fora do ar: Resend sem chave, o mailer lança antes de qualquer chamada de rede. */
function breakMail(): void {
    vi.stubEnv('MAIL_MAILER', 'resend');
    vi.stubEnv('RESEND_API_KEY', '');
}

/** O token cru só existe no e-mail. */
function lastToken(): string {
    const match = /\/verify-email\/([A-Za-z0-9_-]+)/.exec(sentMail.at(-1)?.text ?? '');

    if (!match?.[1]) throw new Error('nenhum link de confirmação no e-mail');

    return match[1];
}

async function signIn(user: Pick<UserRow, 'id'>): Promise<void> {
    await startSession(user.id, false);
}

/** Para onde a action redirecionou, ou null. */
async function redirectOf(call: Promise<unknown>): Promise<string | null> {
    try {
        await call;
    } catch (error) {
        const digest = (error as { digest?: unknown }).digest;

        if (typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT')) return digest.split(';')[2] ?? null;

        throw error;
    }

    return null;
}

async function verifyEmailPage(token: string) {
    const { default: VerifyEmailPage } = await import('@/app/verify-email/[token]/page');

    return VerifyEmailPage({ params: Promise.resolve({ token }) });
}

/** Os elementos da árvore JSX que a página montou, sem renderizar componente nenhum. */
function elementsOf(node: unknown): ReactElement<Record<string, unknown>>[] {
    if (Array.isArray(node)) return node.flatMap(elementsOf);

    return isValidElement<Record<string, unknown>>(node) ? [node, ...elementsOf(node.props.children)] : [];
}

describe('1. o envio que falha não gasta a cota da hora', () => {
    it('depois de cinco envios que falharam, ainda cabem os cinco links da hora', async () => {
        const user = await createUser();

        breakMail();

        for (let i = 0; i < 5; i++) {
            at(i);

            const error = await expectHttpError(sendEmailVerification(user), 500);

            expect(error.message).toBe(EMAIL_VERIFICATION_MESSAGES.mailFailed);
        }

        expect(sentMail).toHaveLength(0);

        // O provedor voltou: os cinco links da hora estão todos lá.
        vi.unstubAllEnvs();

        for (let i = 0; i < 5; i++) {
            at(10 + i * 61);
            await sendEmailVerification(user);
        }

        expect(sentMail).toHaveLength(5);

        // E o teto continua de pé. A janela é a do primeiro pedido (t = 0).
        at(10 + 5 * 61);

        const capped = await expectHttpError(sendEmailVerification(user), 429);

        expect(capped.message).toBe(EMAIL_VERIFICATION_MESSAGES.hourly(55));
        expect(sentMail).toHaveLength(5);
    });

    it('uma falha no meio não tira um dos cinco links', async () => {
        const user = await createUser();

        for (let i = 0; i < 4; i++) {
            at(i * 61);
            await sendEmailVerification(user);
        }

        at(4 * 61);
        breakMail();
        await expectHttpError(sendEmailVerification(user), 500);
        vi.unstubAllEnvs();

        // A falha não gravou pedido, então o intervalo conta do quarto link e o quinto sai na hora.
        await sendEmailVerification(user);
        expect(sentMail).toHaveLength(5);

        at(5 * 61);
        await expectHttpError(sendEmailVerification(user), 429);
        expect(sentMail).toHaveLength(5);
    });

    it('uma rajada de pedidos simultâneos manda um e-mail só, e gasta uma vaga só', async () => {
        const user = await createUser();

        const results = await Promise.allSettled(Array.from({ length: 20 }, () => sendEmailVerification(user)));
        const rejected = results.filter((result) => result.status === 'rejected');

        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);

        for (const { reason } of rejected) {
            expect(reason).toBeInstanceOf(HttpError);
            expect((reason as HttpError).status).toBe(429);
        }

        expect(sentMail).toHaveLength(1);
        expect(await previewEmailVerification(lastToken())).not.toBeNull();

        // Os pedidos recusados devolveram a vaga: os outros quatro links da hora continuam lá.
        for (let i = 1; i <= 4; i++) {
            at(i * 61);
            await sendEmailVerification(user);
        }

        expect(sentMail).toHaveLength(5);

        at(5 * 61);
        await expectHttpError(sendEmailVerification(user), 429);
    });

    it('devolver uma vaga a mais não vira crédito: a conta nunca fica abaixo de zero', async () => {
        expect(await hit('teste:release', 3600, NOW)).toBe(1);

        await release('teste:release', NOW);
        await release('teste:release', NOW);

        expect(await hit('teste:release', 3600, NOW)).toBe(1);
    });
});

describe('2. pedidos simultâneos respeitam o intervalo de 60 s', () => {
    it('dois pedidos ao mesmo tempo (duas abas) mandam um e-mail só, e o link dele vale', async () => {
        const user = await createUser();

        const results = await Promise.allSettled([sendEmailVerification(user), sendEmailVerification(user)]);
        const failure = results.find((result) => result.status === 'rejected');

        expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
        expect(failure?.reason).toBeInstanceOf(HttpError);
        expect(failure?.reason).toMatchObject({ status: 429, message: EMAIL_VERIFICATION_MESSAGES.throttled(60) });

        expect(sentMail).toHaveLength(1);
        expect(await previewEmailVerification(lastToken())).not.toBeNull();
    });
});

describe('3. o link que morreu com a página aberta', () => {
    it('a segunda aba recebe o aviso E a página volta como "Link indisponível", com o caminho certo', async () => {
        const native = await createUser({ email: NATIVE_EMAIL });

        await signIn(native);
        await requestEmailVerification();

        const token = lastToken();

        vi.mocked(refresh).mockClear();

        // Aba 1: confirma e vai para a administração. O sucesso sai pelo redirect, sem refresh.
        expect(await redirectOf(confirmEmail({ token }))).toBe('/admin');
        expect(refresh).not.toHaveBeenCalled();

        // Aba 2, ainda com "Confirmar e-mail" na tela.
        expect(await confirmEmail({ token })).toEqual({
            ok: false,
            status: 404,
            toast: { type: 'error', message: EMAIL_VERIFICATION_MESSAGES.invalid },
        });
        expect(refresh).toHaveBeenCalledTimes(1);

        // O que o refresh traz: não faz falta confirmar de novo, e o caminho é a administração.
        const tree = elementsOf(await verifyEmailPage(token));

        expect(tree[0]?.props.title).toBe('Link indisponível');
        expect(tree.map((element) => element.props.children)).toContain(
            `Não faz falta: o e-mail da sua conta (${NATIVE_EMAIL}) já está confirmado.`,
        );
        expect(tree.find((element) => typeof element.props.href === 'string')?.props).toMatchObject({
            href: '/admin',
            children: 'Ir para a administração',
        });
    });
});

describe('4. runAction: a queda de rede devolve o controle a quem chamou', () => {
    beforeEach(() => {
        // O runAction avisa a barra de progresso e o flash por eventos no `window`.
        vi.stubGlobal('window', new EventTarget());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('rede fora chama onNetworkError, e só ele; o redirect, que também rejeita a Promise, não chama', async () => {
        const callbacks = { onSuccess: vi.fn(), onError: vi.fn(), onNetworkError: vi.fn() };
        const redirect = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;push;/admin;303;' });

        const redirected = await runAction(async (): Promise<ActionResult> => {
            throw redirect;
        }, callbacks);

        expect(redirected).toBeNull();
        expect(callbacks.onNetworkError).not.toHaveBeenCalled();

        const offline = await runAction(async (): Promise<ActionResult> => {
            throw new TypeError('Failed to fetch');
        }, callbacks);

        expect(offline).toBeNull();
        expect(callbacks.onNetworkError).toHaveBeenCalledTimes(1);
        expect(callbacks.onSuccess).not.toHaveBeenCalled();
        expect(callbacks.onError).not.toHaveBeenCalled();
    });
});
