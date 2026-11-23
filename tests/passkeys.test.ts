import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { describeDevice } from '@/lib/device';
import {
    deletePasskey,
    finishPasskeyLogin as finishPasskeyLoginAction,
    finishPasskeyRegistration as finishPasskeyRegistrationAction,
    renamePasskey,
    startPasskeyLogin,
    startPasskeyRegistration,
} from '@/server/actions/passkeys';
import { deleteAccount } from '@/server/actions/settings';
import { SESSION_COOKIE, currentSession, startSession } from '@/server/auth/session';
import { config } from '@/server/config';
import { db } from '@/server/db';
import { passkeys, sessions, users, webauthnChallenges, type UserRow } from '@/server/db/schema';
import { loadPasskeySettings } from '@/server/queries/passkeys';
import { AUTH_MESSAGES } from '@/server/services/auth';
import {
    PASSKEY_MESSAGES,
    beginPasskeyLogin,
    beginPasskeyRegistration,
    finishPasskeyLogin,
    finishPasskeyRegistration,
    pruneExpiredPasskeyChallenges,
    type RelyingParty,
} from '@/server/services/passkeys';
import { expectHttpError } from './support/assertions';
import { createUser } from './support/factories';
import { SoftAuthenticator } from './support/webauthn';

/**
 * Entrar com passkey: cadastrar (com a senha atual), entrar sem senha,
 * gerenciar a lista e as travas — desafio de uso único, origem e domínio,
 * verificação do usuário, contador, conta bloqueada.
 *
 * O aparelho é o SoftAuthenticator (tests/support/webauthn.ts): chaves P-256
 * de verdade, então a conferência é a da SimpleWebAuthn, sem dublê. Nas
 * actions, só o `next/headers` é dublê (cookies em memória e o Origin da
 * requisição), como em tests/blocked-users.test.ts.
 */
const request = vi.hoisted(() => {
    const store = new Map<string, string>();

    return {
        origin: 'https://taskon.test' as string | null,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
        jar: {
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
        },
    };
});

vi.mock('next/headers', () => ({
    cookies: async () => request.jar,
    headers: async () =>
        new Headers({
            'x-forwarded-for': '203.0.113.7',
            'user-agent': request.userAgent,
            ...(request.origin ? { origin: request.origin } : {}),
        }),
}));
vi.mock('next/cache', () => ({ refresh: vi.fn() }));

const ORIGIN = 'https://taskon.test';
const RP: RelyingParty = { id: 'taskon.test', name: 'Raia', origin: ORIGIN };
const IP = '203.0.113.7';
const CHROME_WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const NOW = new Date('2026-10-20T15:00:00Z');

beforeEach(() => {
    request.jar.store.clear();
    request.origin = ORIGIN;
    request.userAgent = CHROME_WINDOWS;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
});

afterEach(() => {
    vi.useRealTimers();
});

async function reload(user: Pick<UserRow, 'id'>): Promise<UserRow> {
    const [row] = await db.select().from(users).where(eq(users.id, user.id));

    return row!;
}

async function passkeysOf(user: Pick<UserRow, 'id'>) {
    return db.select().from(passkeys).where(eq(passkeys.userId, user.id));
}

/** Cadastra uma passkey pelo serviço, como a tela faria. */
async function register(user: UserRow, device = new SoftAuthenticator(), name: string | null = 'iPhone') {
    const options = await beginPasskeyRegistration(await reload(user), { current_password: 'password' }, RP);
    const response = device.register(options, ORIGIN);
    const passkey = await finishPasskeyRegistration(user, { response, name }, RP, CHROME_WINDOWS);

    return { device, options, response, passkey };
}

/** Entra pelo serviço com a passkey do aparelho. */
async function signInWith(device: SoftAuthenticator, overrides: Parameters<SoftAuthenticator['authenticate']>[2] = {}, origin = ORIGIN) {
    const options = await beginPasskeyLogin(IP, RP);

    return finishPasskeyLogin(device.authenticate(options, origin, overrides), IP, RP);
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

describe('cadastrar passkey', () => {
    it('pede a senha atual antes de entregar as opções', async () => {
        const user = await createUser();

        await expectHttpError(beginPasskeyRegistration(user, { current_password: 'errada' }, RP), 422, 'current_password');

        expect(await db.$count(webauthnChallenges)).toBe(0);
    });

    it('guarda a chave pública com o nome, a sincronização e os transportes', async () => {
        const user = await createUser({ name: 'Ana Lima', email: 'ana@taskon.test' });

        const { options, passkey } = await register(user);

        expect(options.rp).toEqual({ id: 'taskon.test', name: 'Raia' });
        expect(options.user).toMatchObject({ name: 'ana@taskon.test', displayName: 'Ana Lima' });
        expect(options.authenticatorSelection).toMatchObject({ residentKey: 'required', userVerification: 'required' });
        expect(options.attestation).toBe('none');

        expect(passkey).toMatchObject({
            userId: user.id,
            name: 'iPhone',
            deviceType: 'multiDevice',
            backedUp: true,
            counter: 0,
            transports: ['internal', 'hybrid'],
            lastUsedAt: null,
        });
        expect(passkey.publicKey).toMatch(/^[A-Za-z0-9_-]+$/);

        // O desafio foi gasto no caminho.
        expect(await db.$count(webauthnChallenges)).toBe(0);
    });

    it('o user handle nasce na primeira passkey e é o mesmo nas seguintes', async () => {
        const user = await createUser();

        const first = await register(user);
        const handle = (await reload(user)).webauthnUserId;

        expect(handle).toBeTruthy();
        expect(first.options.user.id).toBe(handle);

        const second = await register(user, new SoftAuthenticator(), 'Notebook');

        expect(second.options.user.id).toBe(handle);

        // O aparelho que já tem uma passkey da conta não cria outra.
        expect(second.options.excludeCredentials?.map((item) => item.id)).toEqual([first.response.id]);
    });

    it('sem nome, a passkey ganha o do navegador e do sistema', async () => {
        const user = await createUser();

        const { passkey } = await register(user, new SoftAuthenticator(), null);

        expect(passkey.name).toBe('Chrome no Windows');
    });

    it('o desafio vale uma vez: a mesma resposta não cadastra duas vezes', async () => {
        const user = await createUser();
        const { response } = await register(user);

        const error = await expectHttpError(finishPasskeyRegistration(user, { response, name: null }, RP, null), 422);

        expect(error.message).toBe(PASSKEY_MESSAGES.registerFailed);
        expect(await passkeysOf(user)).toHaveLength(1);
    });

    it('o desafio de uma conta não serve para outra — e continua valendo para a dona', async () => {
        const ana = await createUser();
        const bruno = await createUser();
        const device = new SoftAuthenticator();
        const options = await beginPasskeyRegistration(ana, { current_password: 'password' }, RP);
        const response = device.register(options, ORIGIN);

        await expectHttpError(finishPasskeyRegistration(bruno, { response, name: null }, RP, null), 422);

        expect(await passkeysOf(bruno)).toHaveLength(0);

        await finishPasskeyRegistration(ana, { response, name: null }, RP, null);

        expect(await passkeysOf(ana)).toHaveLength(1);
    });

    it('desafio vencido avisa que expirou', async () => {
        const user = await createUser();
        const options = await beginPasskeyRegistration(user, { current_password: 'password' }, RP);
        const response = new SoftAuthenticator().register(options, ORIGIN);

        vi.setSystemTime(new Date(NOW.getTime() + (config.passkeys.challengeMinutes + 1) * 60_000));

        const error = await expectHttpError(finishPasskeyRegistration(user, { response, name: null }, RP, null), 422);

        expect(error.message).toBe(PASSKEY_MESSAGES.expired);
        expect(await db.$count(webauthnChallenges)).toBe(0);
    });

    it('recusa a passkey criada em outro site', async () => {
        const user = await createUser();
        const options = await beginPasskeyRegistration(user, { current_password: 'password' }, RP);
        const response = new SoftAuthenticator().register(options, 'https://taskon-falso.test');

        await expectHttpError(finishPasskeyRegistration(user, { response, name: null }, RP, null), 422);

        expect(await passkeysOf(user)).toHaveLength(0);
    });

    it('recusa aparelho que não confirma quem é a pessoa', async () => {
        const user = await createUser();
        const options = await beginPasskeyRegistration(user, { current_password: 'password' }, RP);
        const response = new SoftAuthenticator({ userVerification: false }).register(options, ORIGIN);

        await expectHttpError(finishPasskeyRegistration(user, { response, name: null }, RP, null), 422);
    });

    it('tem teto por conta', async () => {
        const user = await createUser();

        await db.insert(passkeys).values(
            Array.from({ length: config.passkeys.maxPerUser }, (_, index) => ({
                userId: user.id,
                name: `Passkey ${index}`,
                credentialId: `credencial-${index}`,
                publicKey: 'chave',
                deviceType: 'multiDevice',
            })),
        );

        const error = await expectHttpError(beginPasskeyRegistration(user, { current_password: 'password' }, RP), 422);

        expect(error.message).toBe(PASSKEY_MESSAGES.limit);
    });

    it('a senha errada conta no limite: a sétima tentativa no minuto é 429', async () => {
        const user = await createUser();

        for (let attempt = 0; attempt < 6; attempt++) {
            await expectHttpError(beginPasskeyRegistration(user, { current_password: 'errada' }, RP), 422);
        }

        await expectHttpError(beginPasskeyRegistration(user, { current_password: 'password' }, RP), 429);
    });
});

describe('entrar com passkey', () => {
    it('as opções não listam credenciais e exigem a verificação do usuário', async () => {
        const options = await beginPasskeyLogin(IP, RP);

        expect(options.rpId).toBe('taskon.test');
        expect(options.userVerification).toBe('required');
        expect(options.allowCredentials ?? []).toEqual([]);
        expect(await db.$count(webauthnChallenges, eq(webauthnChallenges.purpose, 'authentication'))).toBe(1);
    });

    it('entra: devolve a dona da passkey e marca o último uso', async () => {
        const user = await createUser();
        const { device, passkey } = await register(user);

        vi.setSystemTime(new Date(NOW.getTime() + 60_000));

        const signedIn = await signInWith(device);

        expect(signedIn.id).toBe(user.id);

        const [row] = await db.select().from(passkeys).where(eq(passkeys.id, passkey.id));

        expect(row?.lastUsedAt?.toISOString()).toBe(new Date(NOW.getTime() + 60_000).toISOString());
    });

    it('o desafio vale uma vez: a mesma assinatura não entra de novo', async () => {
        const user = await createUser();
        const { device } = await register(user);
        const options = await beginPasskeyLogin(IP, RP);
        const response = device.authenticate(options, ORIGIN);

        await finishPasskeyLogin(response, IP, RP);

        const error = await expectHttpError(finishPasskeyLogin(response, IP, RP), 422, 'passkey');

        expect(error.errors?.passkey).toBe(PASSKEY_MESSAGES.loginFailed);
    });

    it('passkey que não existe mais aqui responde no campo `credential`', async () => {
        const user = await createUser();
        const { device, passkey } = await register(user);

        await db.delete(passkeys).where(eq(passkeys.id, passkey.id));

        const error = await expectHttpError(signInWith(device), 422, 'credential');

        expect(error.errors?.credential).toBe(PASSKEY_MESSAGES.unknown);
    });

    it('recusa a assinatura feita para outro site (phishing)', async () => {
        const user = await createUser();
        const { device } = await register(user);

        await expectHttpError(signInWith(device, {}, 'https://taskon-falso.test'), 422, 'passkey');
        await expectHttpError(signInWith(device, { rpId: 'taskon-falso.test' }), 422, 'passkey');
    });

    it('recusa user handle de outra conta', async () => {
        const user = await createUser();
        const { device } = await register(user);

        await expectHttpError(signInWith(device, { userHandle: 'b3V0cmEtY29udGE' }), 422, 'passkey');
    });

    it('aceita a chave que não manda o user handle: a assinatura já amarra a conta', async () => {
        const user = await createUser();
        const { device } = await register(user);

        expect((await signInWith(device, { userHandle: null })).id).toBe(user.id);
    });

    it('sem a verificação do usuário, não entra', async () => {
        const user = await createUser();
        const { device } = await register(user);

        device.options.userVerification = false;

        await expectHttpError(signInWith(device), 422, 'passkey');
    });

    it('contador que volta para trás denuncia um clone', async () => {
        const user = await createUser();
        const { device, response } = await register(user, new SoftAuthenticator({ counts: true, synced: false }));

        await signInWith(device);
        await signInWith(device);

        expect((await passkeysOf(user))[0]?.counter).toBe(2);

        device.rewind(response.id, 1);

        await expectHttpError(signInWith(device), 422, 'passkey');
    });

    it('desafio vencido avisa que expirou', async () => {
        const user = await createUser();
        const { device } = await register(user);
        const options = await beginPasskeyLogin(IP, RP);
        const response = device.authenticate(options, ORIGIN);

        vi.setSystemTime(new Date(NOW.getTime() + (config.passkeys.challengeMinutes + 1) * 60_000));

        const error = await expectHttpError(finishPasskeyLogin(response, IP, RP), 422, 'passkey');

        expect(error.errors?.passkey).toBe(PASSKEY_MESSAGES.expired);
    });

    it('conta bloqueada só ouve isso depois da assinatura certa', async () => {
        const user = await createUser();
        const { device } = await register(user);

        await db.update(users).set({ blockedAt: new Date() }).where(eq(users.id, user.id));

        const wrong = await expectHttpError(signInWith(device, {}, 'https://taskon-falso.test'), 422, 'passkey');

        expect(wrong.errors?.passkey).toBe(PASSKEY_MESSAGES.loginFailed);

        const right = await expectHttpError(signInWith(device), 422, 'passkey');

        expect(right.errors?.passkey).toBe(AUTH_MESSAGES.blocked);
    });

    it('tem teto por IP: a 11ª tentativa no minuto é 429', async () => {
        const user = await createUser();
        const { device } = await register(user);
        const options = await beginPasskeyLogin(IP, RP);
        const response = device.authenticate(options, 'https://taskon-falso.test');

        for (let attempt = 0; attempt < 10; attempt++) {
            await expectHttpError(finishPasskeyLogin(response, IP, RP), 422);
        }

        await expectHttpError(finishPasskeyLogin(response, IP, RP), 429);
    });
});

describe('actions', () => {
    it('entrar pela action abre a sessão, dá as boas-vindas e volta ao destino seguro', async () => {
        const user = await createUser({ name: 'Ana' });
        const { device } = await register(user);

        const started = await startPasskeyLogin();

        expect(started.ok).toBe(true);

        const options = started.ok ? started.data : null;
        const response = device.authenticate(options!, ORIGIN);

        expect(await redirectOf(finishPasskeyLoginAction({ response, remember: true, next: '/boards/7' }))).toBe('/boards/7');
        expect((await currentSession())?.user.id).toBe(user.id);
        expect((await currentSession())?.session.remember).toBe(true);
        expect(request.jar.store.get('taskon_flash')).toContain('Bem-vindo de volta, Ana!');
    });

    it('o `next` de outro site vira o painel', async () => {
        const user = await createUser();
        const { device } = await register(user);
        const started = await startPasskeyLogin();
        const response = device.authenticate(started.ok ? started.data : (null as never), ORIGIN);

        expect(await redirectOf(finishPasskeyLoginAction({ response, remember: false, next: '//evil.test' }))).toBe('/dashboard');
    });

    it('recusa pela action: erro no campo, sem sessão e sem toast', async () => {
        const user = await createUser();
        const { device } = await register(user);
        const started = await startPasskeyLogin();
        const response = device.authenticate(started.ok ? started.data : (null as never), 'https://taskon-falso.test');

        const result = await finishPasskeyLoginAction({ response, remember: false });

        expect(result).toEqual({ ok: false, status: 422, errors: { passkey: PASSKEY_MESSAGES.loginFailed } });
        expect(request.jar.store.has(SESSION_COOKIE)).toBe(false);
    });

    it('resposta malformada é 422, não 500', async () => {
        const result = await finishPasskeyLoginAction({
            response: { id: 'não é base64url!', rawId: 'x', type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON: 'a', authenticatorData: 'b', signature: 'c' } },
            remember: false,
        });

        expect(result).toMatchObject({ ok: false, status: 422 });
    });

    it('cadastrar pela action usa o domínio da requisição e devolve a lista atualizada', async () => {
        const user = await createUser();

        await startSession(user.id, false);

        request.origin = 'https://quadros.exemplo.com';

        const started = await startPasskeyRegistration({ current_password: 'password' });
        const options = started.ok ? started.data : (null as never);

        expect(options.rp.id).toBe('quadros.exemplo.com');

        const response = new SoftAuthenticator().register(options, 'https://quadros.exemplo.com');
        const finished = await finishPasskeyRegistrationAction({ response, name: '  ' });

        expect(finished).toEqual({
            ok: true,
            data: null,
            toast: { type: 'success', message: 'Passkey "Chrome no Windows" cadastrada. Na próxima vez, entre sem digitar a senha.' },
        });

        const settings = await loadPasskeySettings(await reload(user));

        expect(settings.passkeys).toHaveLength(1);
        expect(settings.passkeys[0]).toMatchObject({ name: 'Chrome no Windows', credential_id: response.id, synced: true, last_used_at: null });
        expect(settings.webauthn_user_id).toBe(options.user.id);
        expect(settings.max).toBe(config.passkeys.maxPerUser);
    });

    it('sem Origin (fora do navegador), vale o APP_URL', async () => {
        const user = await createUser();

        await startSession(user.id, false);

        request.origin = null;

        const started = await startPasskeyRegistration({ current_password: 'password' });

        expect(started.ok && started.data.rp.id).toBe('taskon.test');
    });

    it('Origin em http fora de localhost não vira domínio de passkey', async () => {
        const user = await createUser();

        await startSession(user.id, false);

        request.origin = 'http://quadros.exemplo.com';

        const started = await startPasskeyRegistration({ current_password: 'password' });

        expect(started.ok && started.data.rp.id).toBe('taskon.test');
    });

    it('renomear e remover só valem para as passkeys da própria conta', async () => {
        const ana = await createUser();
        const bruno = await createUser();
        const { passkey } = await register(ana);

        await startSession(bruno.id, false);

        expect(await renamePasskey({ passkeyId: passkey.id, name: 'Minha' })).toMatchObject({ ok: false, status: 404 });
        expect(await deletePasskey({ passkeyId: passkey.id })).toMatchObject({ ok: false, status: 404 });
        expect(await passkeysOf(ana)).toHaveLength(1);

        await startSession(ana.id, false);

        expect(await renamePasskey({ passkeyId: passkey.id, name: '  Notebook do trabalho  ' })).toMatchObject({ ok: true });
        expect((await passkeysOf(ana))[0]?.name).toBe('Notebook do trabalho');

        expect(await deletePasskey({ passkeyId: passkey.id })).toEqual({
            ok: true,
            data: null,
            toast: { type: 'success', message: 'Passkey "Notebook do trabalho" removida.' },
        });
        expect(await passkeysOf(ana)).toHaveLength(0);
    });

    it('excluir a conta leva as passkeys junto', async () => {
        const user = await createUser();
        await register(user);

        await startSession(user.id, false);

        expect(await redirectOf(deleteAccount({ password: 'password' }))).toBe('/');
        expect(await db.$count(passkeys)).toBe(0);
        expect(await db.$count(sessions, eq(sessions.userId, user.id))).toBe(0);
    });
});

describe('faxina', () => {
    it('apaga só os desafios vencidos', async () => {
        await beginPasskeyLogin(IP, RP);

        vi.setSystemTime(new Date(NOW.getTime() + (config.passkeys.challengeMinutes + 1) * 60_000));

        await beginPasskeyLogin(IP, RP);
        await pruneExpiredPasskeyChallenges();

        const left = await db.select().from(webauthnChallenges);

        expect(left).toHaveLength(1);
        expect(left[0]!.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('o desafio do cadastro sai junto com a conta', async () => {
        const user = await createUser();

        await beginPasskeyRegistration(user, { current_password: 'password' }, RP);
        await db.delete(users).where(eq(users.id, user.id));

        expect(await db.$count(webauthnChallenges, and(eq(webauthnChallenges.purpose, 'registration')))).toBe(0);
    });
});

describe('nome do aparelho', () => {
    it.each([
        [CHROME_WINDOWS, 'Chrome no Windows'],
        ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', 'Safari no iPhone'],
        ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0', 'Edge no Mac'],
        ['Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36', 'Chrome no Android'],
        ['Mozilla/5.0 (X11; Linux x86_64; rv:142.0) Gecko/20100101 Firefox/142.0', 'Firefox no Linux'],
        ['curl/8.0', null],
        [null, null],
    ])('%s → %s', (userAgent, expected) => {
        expect(describeDevice(userAgent)).toBe(expected);
    });
});
