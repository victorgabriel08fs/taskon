import 'server-only';

import type { AdminAccess, AdminUserRow } from '@/types';
import { config } from '@/server/config';
import type { UserRow } from '@/server/db/schema';

/**
 * Quem manda na administração do Taskon — a política do painel /admin, no
 * mesmo espírito de src/server/policies/board.ts: regras puras, que o
 * servidor confere em toda action e a tela usa só para esconder botões.
 *
 * A hierarquia:
 *
 * | Ação                                  | Admin nativo | Admin concedido |
 * | ------------------------------------- | :----------: | :-------------: |
 * | Abrir o painel                        |      ✓       |        ✓        |
 * | Bloquear / desbloquear conta comum    |      ✓       |        ✓        |
 * | Conceder / tirar admin                |      ✓       |                 |
 * | Bloquear / desbloquear um admin       |      ✓       |                 |
 * | Mexer numa conta de e-mail nativo     |              |                 |
 * | Mexer na própria conta pelo painel    |              |                 |
 *
 * Conceder admin fica com o nativo: um admin concedido que pudesse criar
 * outros (ou tirar e bloquear os colegas) transformaria um descuido numa
 * disputa de poder sem árbitro. O nativo é o árbitro — e ninguém o toca.
 */

export type AdminSubject = Pick<UserRow, 'id' | 'email' | 'emailVerifiedAt' | 'isAdmin' | 'blockedAt'>;

export function isNativeAdminEmail(email: string): boolean {
    return config.admin.nativeEmails.includes(email.trim().toLowerCase());
}

/**
 * O acesso efetivo à administração. O nativo só vale com o e-mail CONFIRMADO
 * (ver config.admin): sem isso, quem criasse a conta com o endereço da lista
 * — que é público — viraria admin. Conta bloqueada não tem acesso nenhum.
 */
export function adminAccess(user: AdminSubject): AdminAccess {
    if (user.blockedAt) return null;

    if (isNativeAdminEmail(user.email)) return user.emailVerifiedAt ? 'native' : 'pending';

    return user.isAdmin ? 'admin' : null;
}

/** O papel de uma conta como a lista do painel o mostra. */
export function adminRole(user: AdminSubject): AdminUserRow['role'] {
    if (isNativeAdminEmail(user.email)) return user.emailVerifiedAt ? 'native' : 'native_pending';

    return user.isAdmin ? 'admin' : 'user';
}

const NOTHING: AdminUserRow['can'] = { grant_admin: false, revoke_admin: false, block: false, unblock: false };

/** O que `viewer` pode fazer com `target` no painel (a tabela lá de cima). */
export function adminCan(viewer: AdminSubject, target: AdminSubject): AdminUserRow['can'] {
    const access = adminAccess(viewer);

    if (access !== 'native' && access !== 'admin') return NOTHING;

    // Ninguém se bloqueia nem se rebaixa pelo painel — e e-mail nativo é
    // intocável, confirmado ou não (quem o ocupou indevidamente perde a conta
    // para o dono de verdade pela redefinição de senha, que só chega à caixa
    // de entrada dele).
    if (target.id === viewer.id || isNativeAdminEmail(target.email)) return NOTHING;

    const native = access === 'native';
    const blocked = target.blockedAt !== null;

    return {
        grant_admin: native && !target.isAdmin && !blocked,
        revoke_admin: native && target.isAdmin,
        block: !blocked && (native || !target.isAdmin),
        unblock: blocked && (native || !target.isAdmin),
    };
}
