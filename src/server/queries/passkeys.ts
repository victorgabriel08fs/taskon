import 'server-only';

import { asc, eq } from 'drizzle-orm';
import type { PasskeySettingsData } from '@/types';
import { config } from '@/server/config';
import { db } from '@/server/db';
import { passkeys, type UserRow } from '@/server/db/schema';
import { passkeyResource } from '@/server/resources/passkey';

/** Configurações › Passkeys: as passkeys da própria pessoa, da mais antiga para a mais nova. */
export async function loadPasskeySettings(user: Pick<UserRow, 'id' | 'webauthnUserId'>): Promise<PasskeySettingsData> {
    const rows = await db
        .select({
            id: passkeys.id,
            name: passkeys.name,
            credentialId: passkeys.credentialId,
            backedUp: passkeys.backedUp,
            createdAt: passkeys.createdAt,
            lastUsedAt: passkeys.lastUsedAt,
        })
        .from(passkeys)
        .where(eq(passkeys.userId, user.id))
        .orderBy(asc(passkeys.createdAt), asc(passkeys.id));

    return {
        passkeys: rows.map(passkeyResource),
        webauthn_user_id: user.webauthnUserId,
        max: config.passkeys.maxPerUser,
    };
}
