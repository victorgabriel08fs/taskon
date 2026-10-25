'use server';

import type { AuthenticationExtensionsClientOutputs } from '@simplewebauthn/server';
import { redirect } from 'next/navigation';
import { defineAction, ok, toast } from '@/server/action';
import type { PasskeyActions } from '@/server/actions/contract';
import { requestMeta, safeRedirectPath, startSession } from '@/server/auth/session';
import { relyingParty } from '@/server/auth/webauthn';
import { flash } from '@/server/flash';
import * as passkeyService from '@/server/services/passkeys';
import { id, nullableString, passwordInput, requiredString, z } from '@/server/validation';

/**
 * Passkeys: entrar sem senha e cadastrar/gerenciar as passkeys da conta. A
 * regra (senha antes de cadastrar, desafio de uso único, conta bloqueada)
 * mora em src/server/services/passkeys.ts; aqui só a forma e o aviso.
 */

/**
 * O que o navegador devolve vem em base64url. Os tetos são folgados para
 * qualquer aparelho de verdade (id até 1023 bytes, chaves pós-quânticas
 * maiores) e só existem para um pedido forjado não chegar gigante.
 */
const base64url = (max: number) => z.string().max(max).regex(/^[A-Za-z0-9_-]+={0,2}$/);

/** As extensões do lado do navegador não são usadas: entram vazias na conferência. */
const ignoredExtensions = z
    .unknown()
    .optional()
    .transform((): AuthenticationExtensionsClientOutputs => ({}));

const credentialEnvelope = {
    id: base64url(1400),
    rawId: base64url(1400),
    type: z.literal('public-key'),
    authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
    clientExtensionResults: ignoredExtensions,
};

const registrationResponse = z.object({
    ...credentialEnvelope,
    response: z.object({
        clientDataJSON: base64url(8192),
        attestationObject: base64url(65_536),
        authenticatorData: base64url(65_536).optional(),
        transports: z.array(z.string().max(32)).max(16).optional(),
        publicKeyAlgorithm: z.number().int().optional(),
        publicKey: base64url(16_384).optional(),
    }),
});

const authenticationResponse = z.object({
    ...credentialEnvelope,
    response: z.object({
        clientDataJSON: base64url(8192),
        authenticatorData: base64url(65_536),
        signature: base64url(16_384),
        userHandle: base64url(512)
            .nullable()
            .optional()
            .transform((value) => value ?? undefined),
    }),
});

/** As opções do login — a tela as pede ao abrir, para o preenchimento automático. */
export const startPasskeyLogin = defineAction(
    z.void(),
    async (_input, ctx) => {
        if (ctx) redirect('/dashboard');

        const { ip } = await requestMeta();

        return passkeyService.beginPasskeyLogin(ip, await relyingParty());
    },
    { auth: 'guest', refresh: false },
) satisfies PasskeyActions['startPasskeyLogin'];

/** Confere a assinatura e entra — o par do `login` com senha, com o mesmo destino e o mesmo aviso. */
export const finishPasskeyLogin = defineAction(
    z.object({
        response: authenticationResponse,
        remember: z.boolean().default(false),
        next: z.string().nullable().optional(),
    }),
    async (input, ctx) => {
        if (ctx) redirect('/dashboard');

        const { ip } = await requestMeta();
        const user = await passkeyService.finishPasskeyLogin(input.response, ip, await relyingParty());

        // Sessão nova, como no login com senha: contra fixação de sessão.
        await startSession(user.id, input.remember);
        await flash(toast('success', `Bem-vindo de volta, ${user.name}!`));

        redirect(safeRedirectPath(input.next) ?? '/dashboard');
    },
    { auth: 'guest', refresh: false },
) satisfies PasskeyActions['finishPasskeyLogin'];

/** Confere a senha atual e devolve as opções do cadastro. Nada na tela muda ainda. */
export const startPasskeyRegistration = defineAction(
    z.object({ current_password: passwordInput() }),
    async (input, { user }) => passkeyService.beginPasskeyRegistration(user, input, await relyingParty()),
    { refresh: false },
) satisfies PasskeyActions['startPasskeyRegistration'];

/** Guarda a passkey criada; a lista volta atualizada na mesma resposta. */
export const finishPasskeyRegistration = defineAction(
    z.object({ response: registrationResponse, name: nullableString(60) }),
    async (input, { user }) => {
        const { userAgent } = await requestMeta();
        const passkey = await passkeyService.finishPasskeyRegistration(user, input, await relyingParty(), userAgent);

        return ok(null, toast('success', `Passkey "${passkey.name}" cadastrada. Na próxima vez, entre sem digitar a senha.`));
    },
) satisfies PasskeyActions['finishPasskeyRegistration'];

export const renamePasskey = defineAction(
    z.object({ passkeyId: id(), name: requiredString(60) }),
    async ({ passkeyId, name }, { user }) => {
        await passkeyService.renamePasskey(user, passkeyId, name);

        return null;
    },
) satisfies PasskeyActions['renamePasskey'];

export const deletePasskey = defineAction(
    z.object({ passkeyId: id() }),
    async ({ passkeyId }, { user }) => {
        const removed = await passkeyService.removePasskey(user, passkeyId);

        return ok(null, toast('success', `Passkey "${removed.name}" removida.`));
    },
) satisfies PasskeyActions['deletePasskey'];
