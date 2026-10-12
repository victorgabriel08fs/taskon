import 'server-only';

import type { Activity, AuthUser, AvatarColor, BoardBackground, BoardRole, ColorKey, Label, User } from '@/types';
import { initialsOf } from '@/lib/initials';
import { toAppIso } from '@/lib/timezone';
import type { ActivityRow, LabelRow, UserRow } from '@/server/db/schema';

/**
 * Resources: o contrato de saída. Cada função devolve EXATAMENTE o formato do
 * antigo `JsonResource` do Laravel — que é o que os tipos de `@/types` (e
 * portanto todo o frontend) esperam. Nunca mande linha crua do banco para o
 * cliente: senha, tokens e colunas internas ficam aqui.
 *
 * Datas saem com `toAppIso` — ISO 8601 com o deslocamento do fuso do app,
 * como o `toIso8601String()` do Carbon.
 */

type UserLike = Pick<UserRow, 'id' | 'name' | 'email' | 'avatarColor' | 'title'>;

/** UserResource. `role` só existe quando o usuário vem como membro de um quadro. */
export function userResource(user: UserLike, role?: BoardRole | string | null): User {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        initials: initialsOf(user.name),
        avatar_color: user.avatarColor as AvatarColor,
        title: user.title,
        ...(role ? { role: role as BoardRole } : {}),
    };
}

/** O usuário logado, como o navegador o recebe (antigo `auth.user` compartilhado). */
export function authUserResource(user: UserRow): AuthUser {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        initials: initialsOf(user.name),
        avatar_color: user.avatarColor as AvatarColor,
        title: user.title,
        email_verified_at: toAppIso(user.emailVerifiedAt),
    };
}

export function labelResource(label: Pick<LabelRow, 'id' | 'name' | 'color'>): Label {
    return { id: label.id, name: label.name, color: label.color as ColorKey };
}

/**
 * ActivityResource. `board` só vem no painel, onde o feed mistura quadros —
 * no quadro a chave nem existe.
 */
export function activityResource(
    activity: Pick<ActivityRow, 'id' | 'type' | 'description' | 'properties' | 'createdAt'>,
    user: UserLike | null,
    board?: { id: number; title: string; background: string } | null,
): Activity {
    return {
        id: activity.id,
        type: activity.type,
        description: activity.description,
        properties: activity.properties ?? null,
        created_at: toAppIso(activity.createdAt) ?? '',
        user: user ? userResource(user) : null,
        ...(board ? { board: { id: board.id, title: board.title, background: board.background as BoardBackground } } : {}),
    };
}
