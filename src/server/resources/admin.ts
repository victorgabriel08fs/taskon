import 'server-only';

import type { AdminEvent, AdminUserRow, AvatarColor } from '@/types';
import { initialsOf } from '@/lib/initials';
import { toAppIso } from '@/lib/timezone';
import type { AdminEventRow, UserRow } from '@/server/db/schema';
import { adminCan, adminRole, type AdminSubject } from '@/server/policies/admin';

/**
 * Os resources do painel de administração. Como os outros, só dão forma ao
 * que a consulta já trouxe (src/server/queries/admin.ts): o hash da senha e as
 * colunas internas nunca saem daqui, e os números chegam agregados do banco.
 */

/** Uma conta como a consulta do painel a traz: a linha + o que foi agregado. */
export type AdminUserSource = Pick<
    UserRow,
    'id' | 'name' | 'email' | 'avatarColor' | 'createdAt' | 'emailVerifiedAt' | 'isAdmin' | 'blockedAt'
> & {
    lastSeenAt: Date | null;
    boardsCount: number;
    /** Nome de quem bloqueou — null se a conta dessa pessoa não existe mais. */
    blockedByName: string | null;
};

/**
 * AdminUserRow. Papel e `can` saem da mesma política que o serviço confere a
 * cada clique (src/server/policies/admin.ts): o `can` é o que QUEM ESTÁ VENDO
 * pode fazer com esta conta, e a tela só o usa para esconder botões.
 */
export function adminUserResource(user: AdminUserSource, viewer: AdminSubject): AdminUserRow {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        initials: initialsOf(user.name),
        avatar_color: user.avatarColor as AvatarColor,
        created_at: toAppIso(user.createdAt) ?? '',
        last_seen_at: toAppIso(user.lastSeenAt),
        boards_count: user.boardsCount,
        email_verified: user.emailVerifiedAt !== null,
        role: adminRole(user),
        blocked_at: toAppIso(user.blockedAt),
        blocked_by: user.blockedAt ? user.blockedByName : null,
        can: adminCan(viewer, user),
    };
}

/** Uma linha do histórico com o nome de quem fez (null se a conta não existe mais). */
export type AdminEventSource = Pick<AdminEventRow, 'id' | 'type' | 'targetName' | 'targetEmail' | 'createdAt'> & {
    actorName: string | null;
};

/** AdminEvent. O alvo vem copiado na própria linha: sobrevive à exclusão da conta. */
export function adminEventResource(event: AdminEventSource): AdminEvent {
    return {
        id: event.id,
        type: event.type as AdminEvent['type'],
        actor: event.actorName,
        target_name: event.targetName,
        target_email: event.targetEmail,
        created_at: toAppIso(event.createdAt) ?? '',
    };
}
