import { WebAuthnError, sendSignal } from '@simplewebauthn/browser';

/**
 * O lado do navegador das passkeys: o que dizer quando o APARELHO recusou (o
 * que o servidor recusa já chega com a mensagem dele) e os sinais que avisam
 * o aparelho do que mudou. A cerimônia em si é a da @simplewebauthn/browser,
 * chamada direto pelos componentes.
 */

/** O mesmo texto de PASSKEY_MESSAGES.loginFailed (o navegador não importa código de servidor). */
export const PASSKEY_LOGIN_FAILED = 'Não foi possível entrar com a passkey. Tente de novo ou entre com a senha.';

export const PASSKEY_UNSUPPORTED = 'Este navegador não oferece passkeys. Entre com a senha.';

/**
 * A pessoa fechou o diálogo do aparelho, o tempo acabou, ou outra cerimônia
 * tomou o lugar desta (o botão cancela o preenchimento automático). Nada
 * disso é erro para mostrar: ela sabe o que fez.
 */
export function isCeremonyCancel(error: unknown): boolean {
    if (error instanceof WebAuthnError) {
        if (error.code === 'ERROR_CEREMONY_ABORTED') return true;

        // O NotAllowedError chega embrulhado: os navegadores o usam para
        // "cancelou" e para "demorou", sem distinguir.
        return error.code === 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY' && (error.cause as Error | undefined)?.name === 'NotAllowedError';
    }

    return error instanceof Error && (error.name === 'NotAllowedError' || error.name === 'AbortError');
}

/** Por que o aparelho não criou a passkey, em português. */
export function registrationErrorMessage(error: unknown): string {
    if (error instanceof WebAuthnError) {
        switch (error.code) {
            case 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED':
                return 'Este aparelho já tem uma passkey desta conta.';
            case 'ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT':
            case 'ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT':
            case 'ERROR_AUTHENTICATOR_NO_SUPPORTED_PUBKEYCREDPARAMS_ALG':
                return 'Este aparelho não guarda passkeys que confirmam quem é você. Tente pelo celular ou por outro aparelho.';
        }
    }

    return 'Não foi possível cadastrar a passkey. Tente de novo.';
}

/**
 * O servidor não conhece mais esta passkey (foi removida em outro aparelho):
 * o navegador pode tirá-la da lista do preenchimento. Sinal é "tente": quem
 * não entende, ignora.
 */
export function forgetPasskey(credentialID: string): void {
    sendSignal({ signalName: 'unknownCredential', rpID: window.location.hostname, credentialID }).catch(() => {});
}

/**
 * Diz ao aparelho quais passkeys da conta ainda valem e qual o nome e o
 * e-mail de agora — as removidas somem do preenchimento, e a lista mostra o
 * e-mail novo depois de uma troca no perfil. O RP ID é o hostname: é o
 * domínio que o servidor usa (src/server/auth/webauthn.ts).
 */
export function syncPasskeys(user: { webauthnUserId: string; email: string; name: string }, credentialIDs: string[]): void {
    const rpID = window.location.hostname;

    sendSignal({
        signalName: 'allAcceptedCredentials',
        rpID,
        userID: user.webauthnUserId,
        allAcceptedCredentialIDs: credentialIDs,
    }).catch(() => {});

    sendSignal({
        signalName: 'currentUserDetails',
        rpID,
        userID: user.webauthnUserId,
        userName: user.email,
        userDisplayName: user.name,
    }).catch(() => {});
}
