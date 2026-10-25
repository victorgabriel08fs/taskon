import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import type {
    AuthenticationResponseJSON,
    PublicKeyCredentialCreationOptionsJSON,
    PublicKeyCredentialRequestOptionsJSON,
    RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { isoBase64URL, isoCBOR, isoUint8Array } from '@simplewebauthn/server/helpers';

/**
 * Um autenticador de mentira, mas com criptografia de verdade: gera um par de
 * chaves P-256 por passkey, monta o `authenticatorData`, o `attestationObject`
 * (formato "none") e o `clientDataJSON` como o navegador faria, e assina o
 * login com a chave privada. Assim os testes passam pela conferência real da
 * SimpleWebAuthn — desafio, origem, RP ID, flags, assinatura e contador —, e
 * não por um dublê dela.
 */

type CborValue = Parameters<typeof isoCBOR.encode>[0];

const sha256 = (data: Uint8Array | string) => new Uint8Array(createHash('sha256').update(data).digest());

/** Flags do authenticatorData (WebAuthn §6.1). */
const FLAG = { userPresent: 0x01, userVerified: 0x04, backupEligible: 0x08, backedUp: 0x10, attestedData: 0x40 } as const;

interface StoredCredential {
    id: string;
    rpId: string;
    userHandle: string;
    privateKey: KeyObject;
    counter: number;
}

export interface SoftAuthenticatorOptions {
    /** O aparelho confirma quem é a pessoa (digital, rosto, PIN). Padrão: sim. */
    userVerification?: boolean;
    /** Passkey sincronizada na nuvem do provedor. Padrão: sim. */
    synced?: boolean;
    /** Chave física conta as assinaturas; passkey sincronizada manda sempre 0. Padrão: não conta. */
    counts?: boolean;
}

export class SoftAuthenticator {
    readonly credentials: StoredCredential[] = [];

    /** Mutável de propósito: o teste troca o comportamento do aparelho no meio do caminho. */
    constructor(public options: SoftAuthenticatorOptions = {}) {}

    private flags(extra = 0): number {
        const { userVerification = true, synced = true } = this.options;

        return (
            FLAG.userPresent |
            (userVerification ? FLAG.userVerified : 0) |
            (synced ? FLAG.backupEligible | FLAG.backedUp : 0) |
            extra
        );
    }

    /** O `navigator.credentials.create()`. */
    register(options: PublicKeyCredentialCreationOptionsJSON, origin: string): RegistrationResponseJSON {
        const rpId = options.rp.id ?? new URL(origin).hostname;
        const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
        const jwk = publicKey.export({ format: 'jwk' });
        const credentialId = new Uint8Array(randomBytes(16));

        // A chave pública em COSE: kty EC2, alg ES256, curva P-256, x e y.
        const cose = isoCBOR.encode(
            new Map<string | number, CborValue>([
                [1, 2],
                [3, -7],
                [-1, 1],
                [-2, isoBase64URL.toBuffer(jwk.x!)],
                [-3, isoBase64URL.toBuffer(jwk.y!)],
            ]),
        );

        const idLength = new Uint8Array([credentialId.length >> 8, credentialId.length & 0xff]);
        const authData = isoUint8Array.concat([
            sha256(rpId),
            new Uint8Array([this.flags(FLAG.attestedData)]),
            new Uint8Array(4), // contador 0
            new Uint8Array(16), // AAGUID zerado
            idLength,
            credentialId,
            cose,
        ]);

        const attestationObject = isoCBOR.encode(
            new Map<string | number, CborValue>([
                ['fmt', 'none'],
                ['attStmt', new Map<string | number, CborValue>()],
                ['authData', authData],
            ]),
        );

        const clientDataJSON = JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin, crossOrigin: false });
        const id = isoBase64URL.fromBuffer(credentialId);

        this.credentials.push({ id, rpId, userHandle: options.user.id, privateKey, counter: 0 });

        return {
            id,
            rawId: id,
            type: 'public-key',
            authenticatorAttachment: 'platform',
            clientExtensionResults: {},
            response: {
                clientDataJSON: isoBase64URL.fromUTF8String(clientDataJSON),
                attestationObject: isoBase64URL.fromBuffer(attestationObject),
                transports: ['internal', 'hybrid'],
            },
        };
    }

    /**
     * O `navigator.credentials.get()`: assina o desafio com a passkey pedida
     * (ou a última criada). `rpId` troca o domínio que o aparelho assina, para
     * simular a passkey de outro site.
     */
    authenticate(
        options: PublicKeyCredentialRequestOptionsJSON,
        origin: string,
        { credentialId, rpId, userHandle }: { credentialId?: string; rpId?: string; userHandle?: string | null } = {},
    ): AuthenticationResponseJSON {
        const credential = credentialId
            ? this.credentials.find((item) => item.id === credentialId)
            : this.credentials.at(-1);

        if (!credential) throw new Error('o autenticador não tem essa passkey');

        if (this.options.counts) credential.counter += 1;

        const counter = new Uint8Array(4);

        new DataView(counter.buffer).setUint32(0, credential.counter);

        const authenticatorData = isoUint8Array.concat([
            sha256(rpId ?? options.rpId ?? credential.rpId),
            new Uint8Array([this.flags()]),
            counter,
        ]);

        const clientDataJSON = JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin, crossOrigin: false });
        const signature = sign('sha256', isoUint8Array.concat([authenticatorData, sha256(clientDataJSON)]), credential.privateKey);

        return {
            id: credential.id,
            rawId: credential.id,
            type: 'public-key',
            authenticatorAttachment: 'platform',
            clientExtensionResults: {},
            response: {
                clientDataJSON: isoBase64URL.fromUTF8String(clientDataJSON),
                authenticatorData: isoBase64URL.fromBuffer(authenticatorData),
                signature: isoBase64URL.fromBuffer(new Uint8Array(signature)),
                ...(userHandle === null ? {} : { userHandle: userHandle ?? credential.userHandle }),
            },
        };
    }

    /** Volta o contador, como um clone da chave física faria. */
    rewind(credentialId: string, counter: number): void {
        const credential = this.credentials.find((item) => item.id === credentialId);

        if (credential) credential.counter = counter;
    }
}
