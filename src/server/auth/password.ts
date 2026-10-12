import 'server-only';

import bcrypt from 'bcryptjs';
import { config } from '@/server/config';

/**
 * bcrypt, como no Laravel — e compatível com os hashes `$2y$` que ele gerava,
 * então uma importação da base antiga continua logando com a mesma senha.
 *
 * bcryptjs é JavaScript puro: nada de binário nativo para compilar na Vercel.
 */
const rounds = () => (process.env.VITEST ? 4 : config.auth.bcryptRounds);

export function hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, rounds());
}

export async function verifyPassword(plain: string, hash: string | null | undefined): Promise<boolean> {
    if (!hash) return false;

    try {
        return await bcrypt.compare(plain, hash);
    } catch {
        return false;
    }
}

/**
 * Hash de mentira, para gastar o mesmo tempo quando o e-mail não existe — sem
 * ele, a demora do login denunciaria quais contas existem.
 */
let dummyHash: Promise<string> | null = null;

export async function burnPasswordCheck(plain: string): Promise<void> {
    dummyHash ??= bcrypt.hash('taskon-dummy-password', rounds());
    await verifyPassword(plain, await dummyHash);
}
