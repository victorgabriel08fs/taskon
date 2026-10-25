import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import {
    generateAuthenticationOptions,
    generateRegistrationOptions,
    verifyAuthenticationResponse,
    verifyRegistrationResponse,
    type AuthenticationResponseJSON,
    type PublicKeyCredentialCreationOptionsJSON,
    type PublicKeyCredentialRequestOptionsJSON,
    type RegistrationResponseJSON,
    type VerifiedAuthenticationResponse,
    type VerifiedRegistrationResponse,
} from '@simplewebauthn/server';
import { COSEALG, isoBase64URL } from '@simplewebauthn/server/helpers';
import { and, count, eq, isNull, lte } from 'drizzle-orm';
import { describeDevice } from '@/lib/device';
import { verifyPassword } from '@/server/auth/password';
import { throttle } from '@/server/auth/rate-limit';
import { config } from '@/server/config';
import { db } from '@/server/db';
import { passkeys, users, webauthnChallenges, type PasskeyRow, type UserRow } from '@/server/db/schema';
import { HttpError, abortUnless, invalid } from '@/server/errors';
import { AUTH_MESSAGES } from '@/server/services/auth';

/**
 * Entrar com passkey (WebAuthn) — o que no meu-finan o plugin de passkey do
 * Better Auth fazia, aqui sobre a mesma biblioteca que ele usa por baixo
 * (SimpleWebAuthn) e a sessão própria do Taskon.
 *
 * Duas cerimônias, cada uma em duas metades:
 *
 *   cadastrar: senha atual → opções (com desafio) → aparelho cria a passkey →
 *              o servidor confere e guarda a chave pública;
 *   entrar:    opções (com desafio) → aparelho assina → o servidor confere a
 *              assinatura com a chave guardada e abre a sessão.
 *
 * O desafio vale uma vez e por pouco tempo (webauthnChallenges, no schema).
 * Nada aqui toca em cookie ou cabeçalho: a origem chega por parâmetro
 * (src/server/auth/webauthn.ts) e a sessão é aberta pela action.
 */

/** O site da cerimônia: o domínio da passkey, o nome mostrado e a origem assinada. */
export interface RelyingParty {
    id: string;
    name: string;
    origin: string;
}

export const PASSKEY_MESSAGES = {
    loginFailed: 'Não foi possível entrar com a passkey. Tente de novo ou entre com a senha.',
    unknown: 'Essa passkey não vale mais nesta conta. Entre com a senha e cadastre outra em Configurações › Passkeys.',
    expired: 'O pedido da passkey expirou. Tente de novo.',
    registerFailed: 'Não foi possível cadastrar a passkey. Tente de novo.',
    alreadyRegistered: 'Essa passkey já está cadastrada.',
    wrongPassword: 'A senha atual está incorreta.',
    limit: `Você já tem ${config.passkeys.maxPerUser} passkeys, o máximo. Remova uma que não usa mais para cadastrar outra.`,
} as const;

/**
 * EdDSA, ES256 e RS256: o que todo aparelho de hoje usa. Fixas de propósito —
 * sem a lista, a biblioteca sonda o Node atrás de ML-DSA (pós-quântica), que
 * no Node 24 ainda é experimental e enche o log de avisos. O cadastro e a
 * conferência precisam da MESMA lista.
 */
const ALGORITHMS = [COSEALG.EdDSA, COSEALG.ES256, COSEALG.RS256];

/** Sem nome digitado nem User-Agent reconhecível. */
const FALLBACK_NAME = 'Passkey';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Sem IP conhecido (fora de proxy), todas as requisições dividem o mesmo balde. */
const ipKey = (ip: string | null) => ip ?? 'desconhecido';

/* -------------------------------------------------------------------------- */
/* Desafios                                                                    */
/* -------------------------------------------------------------------------- */

type Purpose = 'registration' | 'authentication';

/** O que a conferência achou — para o aviso distinguir "expirou" de "não serve". */
type ChallengeStatus = 'ok' | 'expired' | 'missing';

async function storeChallenge(challenge: string, purpose: Purpose, userId: number | null, now: Date): Promise<void> {
    await db.insert(webauthnChallenges).values({
        id: sha256(challenge),
        purpose,
        userId,
        expiresAt: new Date(now.getTime() + config.passkeys.challengeMinutes * 60_000),
        createdAt: now,
    });
}

/**
 * Confere e GASTA o desafio que voltou dentro da resposta do aparelho.
 * Apagar é a conferência: dois envios da mesma resposta disputam a linha, e
 * só um a leva. O vencido também sai — já não serve para nada.
 *
 * O desafio do cadastro é de uma conta só: outra sessão não o aproveita.
 */
async function consumeChallenge(challenge: string, purpose: Purpose, userId: number | null, now: Date): Promise<ChallengeStatus> {
    const [row] = await db
        .delete(webauthnChallenges)
        .where(
            and(
                eq(webauthnChallenges.id, sha256(challenge)),
                eq(webauthnChallenges.purpose, purpose),
                userId === null ? isNull(webauthnChallenges.userId) : eq(webauthnChallenges.userId, userId),
            ),
        )
        .returning({ expiresAt: webauthnChallenges.expiresAt });

    if (!row) return 'missing';

    return row.expiresAt.getTime() > now.getTime() ? 'ok' : 'expired';
}

/**
 * O `expectedChallenge` da SimpleWebAuthn, guardando o que a conferência
 * achou: a biblioteca só aceita sim ou não, e o aviso precisa saber se foi
 * "expirou" (tente de novo) ou outra coisa.
 */
function challengeCheck(purpose: Purpose, userId: number | null, now: Date) {
    const result = { status: 'missing' as ChallengeStatus };

    return {
        result,
        verify: async (challenge: string) => (result.status = await consumeChallenge(challenge, purpose, userId, now)) === 'ok',
    };
}

/** Faxina noturna (cron de arquivamento): desafio vencido não serve para nada. */
export async function pruneExpiredPasskeyChallenges(now = new Date()): Promise<void> {
    await db.delete(webauthnChallenges).where(lte(webauthnChallenges.expiresAt, now));
}

/* -------------------------------------------------------------------------- */
/* Cadastro                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * O "user handle" da conta, criado na primeira passkey. Grava só se ainda não
 * houver um: dois cadastros simultâneos terminam com o mesmo valor.
 */
async function webauthnUserIdOf(user: Pick<UserRow, 'id' | 'webauthnUserId'>): Promise<string> {
    if (user.webauthnUserId) return user.webauthnUserId;

    await db
        .update(users)
        .set({ webauthnUserId: isoBase64URL.fromBuffer(randomBytes(32)) })
        .where(and(eq(users.id, user.id), isNull(users.webauthnUserId)));

    const [row] = await db.select({ webauthnUserId: users.webauthnUserId }).from(users).where(eq(users.id, user.id)).limit(1);

    abortUnless(row?.webauthnUserId, 404);

    return row.webauthnUserId;
}

/**
 * Primeira metade do cadastro: confere a senha atual e devolve as opções que
 * o navegador passa ao aparelho.
 *
 * A senha é a trava contra a sessão emprestada. Quem pega um navegador já
 * logado (um computador compartilhado, uma sessão esquecida aberta) não pode
 * plantar uma passkey dele na conta e voltar quando quiser — é a mesma regra
 * da troca de senha e da exclusão da conta. Throttle de 6 por minuto, como
 * na troca de senha, para a senha não virar um jeito de adivinhar a senha.
 */
export async function beginPasskeyRegistration(
    user: Pick<UserRow, 'id' | 'name' | 'email' | 'password' | 'webauthnUserId'>,
    input: { current_password: string },
    rp: RelyingParty,
    now = new Date(),
): Promise<PublicKeyCredentialCreationOptionsJSON> {
    await throttle(`passkey-register:${user.id}`, 6, 1);

    if (!(await verifyPassword(input.current_password, user.password))) {
        invalid('current_password', PASSKEY_MESSAGES.wrongPassword);
    }

    const existing = await db
        .select({ credentialId: passkeys.credentialId, transports: passkeys.transports })
        .from(passkeys)
        .where(eq(passkeys.userId, user.id));

    if (existing.length >= config.passkeys.maxPerUser) throw new HttpError(422, PASSKEY_MESSAGES.limit);

    const options = await generateRegistrationOptions({
        rpName: rp.name,
        rpID: rp.id,
        userID: isoBase64URL.toBuffer(await webauthnUserIdOf(user)),
        userName: user.email,
        userDisplayName: user.name,
        timeout: config.passkeys.ceremonyTimeoutMs,
        supportedAlgorithmIDs: ALGORITHMS,

        // Sem atestado: o Taskon não restringe marca de aparelho, e pedir um
        // só daria ao navegador um motivo para perguntar se a pessoa autoriza.
        attestationType: 'none',

        // O aparelho que já tem uma passkey desta conta recusa criar outra.
        excludeCredentials: existing.map((row) => ({ id: row.credentialId, transports: row.transports ?? undefined })),
        authenticatorSelection: {
            // Passkey de verdade, que o aparelho encontra sozinho: o login não
            // pergunta o e-mail antes, então uma credencial "não descobrível"
            // nunca seria oferecida.
            residentKey: 'required',

            // A passkey substitui a senha, então ela precisa provar que é a
            // pessoa (digital, rosto, PIN) — não só que alguém tocou na chave.
            userVerification: 'required',
        },
    });

    await storeChallenge(options.challenge, 'registration', user.id, now);

    return options;
}

/**
 * Segunda metade do cadastro: confere o que o aparelho criou e guarda a
 * chave pública. O nome é o digitado ou, sem ele, o do navegador e do
 * sistema ("Chrome no Windows").
 */
export async function finishPasskeyRegistration(
    user: Pick<UserRow, 'id'>,
    input: { response: RegistrationResponseJSON; name: string | null },
    rp: RelyingParty,
    userAgent: string | null,
    now = new Date(),
): Promise<PasskeyRow> {
    const challenge = challengeCheck('registration', user.id, now);
    let verification: VerifiedRegistrationResponse;

    try {
        verification = await verifyRegistrationResponse({
            response: input.response,
            expectedChallenge: challenge.verify,
            expectedOrigin: rp.origin,
            expectedRPID: rp.id,
            requireUserVerification: true,
            supportedAlgorithmIDs: ALGORITHMS,
        });
    } catch (error) {
        // O detalhe (origem errada, assinatura, formato) fica no log da função;
        // para a pessoa, só o que fazer.
        console.warn('[passkeys] cadastro recusado:', error instanceof Error ? error.message : error);

        throw new HttpError(422, challenge.result.status === 'expired' ? PASSKEY_MESSAGES.expired : PASSKEY_MESSAGES.registerFailed);
    }

    if (!verification.verified) throw new HttpError(422, PASSKEY_MESSAGES.registerFailed);

    const { credential, credentialDeviceType, credentialBackedUp, aaguid } = verification.registrationInfo;

    return db.transaction(async (tx) => {
        // O teto de novo, agora com a conta travada: dois cadastros em abas
        // diferentes entram em fila, e o segundo vê o primeiro.
        await tx.select({ id: users.id }).from(users).where(eq(users.id, user.id)).limit(1).for('no key update');

        const [owned] = await tx.select({ total: count() }).from(passkeys).where(eq(passkeys.userId, user.id));

        if ((owned?.total ?? 0) >= config.passkeys.maxPerUser) throw new HttpError(422, PASSKEY_MESSAGES.limit);

        const [created] = await tx
            .insert(passkeys)
            .values({
                userId: user.id,
                name: input.name ?? describeDevice(userAgent) ?? FALLBACK_NAME,
                credentialId: credential.id,
                publicKey: isoBase64URL.fromBuffer(credential.publicKey),
                counter: credential.counter,
                deviceType: credentialDeviceType,
                backedUp: credentialBackedUp,
                transports: credential.transports ?? null,
                aaguid,
            })
            .onConflictDoNothing({ target: passkeys.credentialId })
            .returning();

        if (!created) throw new HttpError(422, PASSKEY_MESSAGES.alreadyRegistered);

        return created;
    });
}

/* -------------------------------------------------------------------------- */
/* Login                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Primeira metade do login: as opções, sem lista de credenciais — o aparelho
 * oferece as passkeys que tem para este site, e a escolhida diz de quem é.
 * A tela de login já pede isto ao abrir (o preenchimento automático), daí o
 * teto por IP mais folgado que o do login.
 */
export async function beginPasskeyLogin(
    ip: string | null,
    rp: RelyingParty,
    now = new Date(),
): Promise<PublicKeyCredentialRequestOptionsJSON> {
    await throttle(`passkey-options:${ipKey(ip)}`, 30, 1);

    const options = await generateAuthenticationOptions({
        rpID: rp.id,
        userVerification: 'required',
        timeout: config.passkeys.ceremonyTimeoutMs,
    });

    await storeChallenge(options.challenge, 'authentication', null, now);

    return options;
}

/**
 * Segunda metade do login: confere a assinatura com a chave pública guardada
 * e devolve a dona da passkey. Os erros vão por campo, sem toast — a tela os
 * mostra embaixo do botão:
 *
 *  - `credential`: a passkey não existe mais aqui (removida em outro
 *    aparelho). A tela avisa o navegador, que pode escondê-la da lista;
 *  - `passkey`: qualquer outra recusa.
 *
 * Como no login com senha, a conta bloqueada só ouve isso depois da prova
 * certa, e o teto por IP é o mesmo (10 por minuto).
 */
export async function finishPasskeyLogin(
    response: AuthenticationResponseJSON,
    ip: string | null,
    rp: RelyingParty,
    now = new Date(),
): Promise<UserRow> {
    await throttle(`passkey-login:${ipKey(ip)}`, 10, 1);

    const [found] = await db
        .select({ passkey: passkeys, user: users })
        .from(passkeys)
        .innerJoin(users, eq(users.id, passkeys.userId))
        .where(eq(passkeys.credentialId, response.id))
        .limit(1);

    if (!found) invalid('credential', PASSKEY_MESSAGES.unknown);

    const { passkey, user } = found;

    // O aparelho devolve o user handle gravado na passkey; ele tem de ser o
    // desta conta. (Algumas chaves físicas antigas não mandam — aí vale a
    // assinatura, que já amarra a credencial à conta.)
    const handle = response.response.userHandle;

    if (handle && user.webauthnUserId && handle !== user.webauthnUserId) invalid('passkey', PASSKEY_MESSAGES.loginFailed);

    const challenge = challengeCheck('authentication', null, now);
    let verification: VerifiedAuthenticationResponse;

    try {
        verification = await verifyAuthenticationResponse({
            response,
            expectedChallenge: challenge.verify,
            expectedOrigin: rp.origin,
            expectedRPID: rp.id,
            credential: {
                id: passkey.credentialId,
                publicKey: isoBase64URL.toBuffer(passkey.publicKey),
                counter: passkey.counter,
                transports: passkey.transports ?? undefined,
            },
            requireUserVerification: true,
        });
    } catch (error) {
        console.warn('[passkeys] login recusado:', error instanceof Error ? error.message : error);

        invalid('passkey', challenge.result.status === 'expired' ? PASSKEY_MESSAGES.expired : PASSKEY_MESSAGES.loginFailed);
    }

    if (!verification.verified) invalid('passkey', PASSKEY_MESSAGES.loginFailed);

    // O contador novo é a defesa contra clone (um valor que volta para trás é
    // recusado acima); "sincronizada" pode mudar depois do cadastro.
    await db
        .update(passkeys)
        .set({
            counter: verification.authenticationInfo.newCounter,
            backedUp: verification.authenticationInfo.credentialBackedUp,
            lastUsedAt: now,
        })
        .where(eq(passkeys.id, passkey.id));

    if (user.blockedAt) invalid('passkey', AUTH_MESSAGES.blocked);

    return user;
}

/* -------------------------------------------------------------------------- */
/* Gerenciar                                                                   */
/* -------------------------------------------------------------------------- */

/** Só a própria pessoa mexe nas passkeys dela: id de outra conta é 404. */
export async function renamePasskey(user: Pick<UserRow, 'id'>, passkeyId: number, name: string): Promise<void> {
    const [renamed] = await db
        .update(passkeys)
        .set({ name })
        .where(and(eq(passkeys.id, passkeyId), eq(passkeys.userId, user.id)))
        .returning({ id: passkeys.id });

    abortUnless(renamed, 404);
}

/**
 * Remove a passkey da conta. Sem pedir a senha: tirar uma porta não abre
 * outra — o pior que uma sessão emprestada faz aqui é a pessoa voltar a
 * entrar com a senha. O aparelho continua guardando a passkey até a tela
 * avisá-lo (os sinais de passkey-settings.tsx) ou a pessoa apagá-la lá.
 */
export async function removePasskey(user: Pick<UserRow, 'id'>, passkeyId: number): Promise<Pick<PasskeyRow, 'id' | 'name'>> {
    const [removed] = await db
        .delete(passkeys)
        .where(and(eq(passkeys.id, passkeyId), eq(passkeys.userId, user.id)))
        .returning({ id: passkeys.id, name: passkeys.name });

    abortUnless(removed, 404);

    return removed;
}
