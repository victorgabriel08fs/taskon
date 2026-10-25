import 'server-only';

import type { Passkey } from '@/types';
import { toAppIso } from '@/lib/timezone';
import type { PasskeyRow } from '@/server/db/schema';

/**
 * A passkey como a tela a vê. A chave pública e o contador ficam aqui: não
 * são segredo, mas a tela não precisa deles, e o resource é o lugar onde se
 * decide o que sai.
 */
export function passkeyResource(row: Pick<PasskeyRow, 'id' | 'name' | 'credentialId' | 'backedUp' | 'createdAt' | 'lastUsedAt'>): Passkey {
    return {
        id: row.id,
        name: row.name,
        credential_id: row.credentialId,
        synced: row.backedUp,
        created_at: toAppIso(row.createdAt) ?? '',
        last_used_at: toAppIso(row.lastUsedAt),
    };
}
