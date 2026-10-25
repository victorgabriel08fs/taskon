'use client';

import {
    WebAuthnAbortService,
    browserSupportsWebAuthn,
    browserSupportsWebAuthnAutofill,
    startAuthentication,
    type AuthenticationResponseJSON,
} from '@simplewebauthn/browser';
import { KeyRound } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { runAction } from '@/lib/actions';
import { PASSKEY_LOGIN_FAILED, PASSKEY_UNSUPPORTED, forgetPasskey, isCeremonyCancel } from '@/lib/passkeys';
import { finishPasskeyLogin, startPasskeyLogin } from '@/server/actions/passkeys';

type Mode = 'autofill' | 'modal';

/**
 * "Entrar com passkey", em duas portas, como no meu-finan:
 *
 *  - o preenchimento automático (conditional UI): ao abrir a tela, o login
 *    já pede um desafio e o navegador passa a oferecer as passkeys deste site
 *    no campo de e-mail (`autocomplete="username webauthn"`);
 *  - o botão, que abre o diálogo do aparelho na hora.
 *
 * Só uma cerimônia anda por vez: o botão cancela o preenchimento (a
 * @simplewebauthn/browser aborta a anterior), e o preenchimento volta depois
 * de um botão que não deu certo.
 */
export function PasskeyLogin({
    next,
    remember,
    refreshAfterMs,
}: {
    next: string | null;
    remember: boolean;
    /** Depois disso o desafio do preenchimento venceu (config.passkeys.challengeMinutes): quem volta à aba ganha outro. */
    refreshAfterMs: number;
}) {
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // O preenchimento termina quando a pessoa escolhe — talvez depois de
    // marcar "Continuar conectado". Vale o que está na tela naquela hora.
    const latest = useRef({ next, remember });

    useEffect(() => {
        latest.current = { next, remember };
    });

    // Cada cerimônia leva um número; a que não é mais a última não mexe em
    // nada. É o que impede a anterior, cancelada, de apagar o estado da nova.
    const generation = useRef(0);
    const autofillSince = useRef<number | null>(null);

    // Função nomeada: depois de uma recusa, ela mesma religa o preenchimento.
    const ceremony = useCallback(async function runCeremony(mode: Mode): Promise<void> {
        const run = ++generation.current;
        const current = () => generation.current === run;
        const autofill = mode === 'autofill';

        // O desafio antigo do preenchimento sai de cena junto com ele: a volta
        // à aba durante o diálogo do aparelho não deve pedir outro.
        if (!autofill) autofillSince.current = null;

        if (autofill && !(await browserSupportsWebAuthnAutofill().catch(() => false))) return;

        // O do preenchimento é pedido em segundo plano, ao abrir a tela: sem
        // barra de progresso e sem toast — se falhar, sobra o botão.
        const options = autofill
            ? await startPasskeyLogin().catch(() => null)
            : await runAction(() => startPasskeyLogin(), { onNetworkError: () => setPending(false) });

        if (!current()) return;

        if (!options?.ok) {
            if (!autofill) setPending(false);

            return;
        }

        if (autofill) autofillSince.current = Date.now();

        let response: AuthenticationResponseJSON;

        try {
            response = await startAuthentication({ optionsJSON: options.data, useBrowserAutofill: autofill });
        } catch (failure) {
            // Cancelado pelo botão, pela saída da tela ou por um pedido novo.
            if (!current() || autofill) return;

            setPending(false);

            if (!isCeremonyCancel(failure)) setError(PASSKEY_LOGIN_FAILED);

            void runCeremony('autofill');

            return;
        }

        if (!current()) return;

        autofillSince.current = null;
        setError(null);
        setPending(true);

        const result = await runAction(
            () => finishPasskeyLogin({ response, remember: latest.current.remember, next: latest.current.next }),
            { onNetworkError: () => setPending(false) },
        );

        // Sem resultado: ou redirecionou (entrou — o botão gira até a página
        // trocar), ou a rede caiu (o runAction já avisou).
        if (!result || result.ok) return;

        setPending(false);

        // A passkey foi removida em outro aparelho: o navegador pode tirá-la
        // da lista. O 429 já veio como toast; o resto fica embaixo do botão.
        if (result.errors?.credential) forgetPasskey(response.id);

        setError(result.errors?.credential ?? result.errors?.passkey ?? null);

        void runCeremony('autofill');
    }, []);

    useEffect(() => {
        // O objeto da ref, não o valor: a saída invalida o que estiver no ar.
        const counter = generation;

        // Falso positivo: no modo "autofill" o estado só muda depois do
        // primeiro await — o efeito sincroniza com o WebAuthn do navegador.
        // oxlint-disable-next-line react/set-state-in-effect
        void ceremony('autofill');

        // A aba ficou esquecida aberta: na volta, o desafio que o
        // preenchimento segura já venceu. Pede outro antes de a pessoa
        // escolher a passkey e ouvir "expirou".
        const refresh = () => {
            const since = autofillSince.current;

            if (document.visibilityState === 'visible' && since !== null && Date.now() - since > refreshAfterMs) {
                void ceremony('autofill');
            }
        };

        document.addEventListener('visibilitychange', refresh);
        window.addEventListener('focus', refresh);

        return () => {
            counter.current++;
            document.removeEventListener('visibilitychange', refresh);
            window.removeEventListener('focus', refresh);
            WebAuthnAbortService.cancelCeremony();
        };
    }, [ceremony, refreshAfterMs]);

    const signIn = () => {
        if (!browserSupportsWebAuthn()) {
            setError(PASSKEY_UNSUPPORTED);

            return;
        }

        setError(null);
        setPending(true);
        void ceremony('modal');
    };

    return (
        <div className="mt-6 space-y-3">
            <div className="flex items-center gap-3 text-xs text-muted-fg" aria-hidden>
                <span className="h-px flex-1 bg-border" />
                ou
                <span className="h-px flex-1 bg-border" />
            </div>

            <Button type="button" variant="secondary" size="lg" className="w-full" loading={pending} onClick={signIn}>
                {!pending && <KeyRound className="size-4" />}
                Entrar com passkey
            </Button>

            {error ? (
                <p role="alert" className="animate-pop text-center text-xs font-medium text-danger">
                    {error}
                </p>
            ) : (
                <p className="text-center text-xs text-muted-fg">Com a digital, o rosto ou o PIN do aparelho, sem digitar a senha.</p>
            )}
        </div>
    );
}
