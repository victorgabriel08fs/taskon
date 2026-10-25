import 'server-only';

import { headers } from 'next/headers';
import { appUrl, config } from '@/server/config';
import type { RelyingParty } from '@/server/services/passkeys';

/**
 * http só em localhost: fora dele o navegador nem oferece passkey sem HTTPS.
 * (Um IP, como 127.0.0.1, também não serve: o RP ID precisa ser um domínio.)
 */
function siteOrigin(value: string | null): string | null {
    if (!value) return null;

    try {
        const url = new URL(value);
        const local = url.hostname === 'localhost' || url.hostname.endsWith('.localhost');

        return url.protocol === 'https:' || (url.protocol === 'http:' && local) ? url.origin : null;
    } catch {
        return null;
    }
}

/**
 * O site em que a pessoa está — a quem a passkey pertence (o "RP ID" é o
 * hostname) e a origem que o aparelho assina junto.
 *
 * Vem do `Origin` da própria requisição: Server Action só chega aqui depois
 * de o Next conferir que o Origin bate com o Host. Assim produção, preview e
 * localhost funcionam cada um com as próprias passkeys, sem variável de
 * ambiente nenhuma. Do outro lado, isto não abre porta: o aparelho só assina
 * para o domínio em que a passkey foi criada, e a assinatura é conferida
 * contra a chave pública guardada no cadastro.
 *
 * Consequência que vale saber: passkey é do DOMÍNIO. A criada num preview não
 * entra na produção, e trocar o domínio de produção deixa as passkeys para
 * trás — quem tinha entra com a senha e cadastra de novo.
 */
export async function relyingParty(): Promise<RelyingParty> {
    const origin = siteOrigin((await headers()).get('origin')) ?? new URL(appUrl()).origin;

    return { id: new URL(origin).hostname, name: config.appName, origin };
}
