import 'server-only';

import { eq } from 'drizzle-orm';
import type { AvatarColor } from '@/types';
import { hashPassword, verifyPassword } from '@/server/auth/password';
import { throttle } from '@/server/auth/rate-limit';
import { db } from '@/server/db';
import { passwordResetTokens, users, type UserRow } from '@/server/db/schema';
import { invalid } from '@/server/errors';
import { AUTH_MESSAGES, ensureEmailAvailable, isUniqueViolation } from '@/server/services/auth';

/**
 * A conta da própria pessoa: perfil, senha e exclusão — o antigo
 * `ProfileController` + `PasswordController` de Settings.
 */

/**
 * Atualiza nome, e-mail, cargo e cor do avatar. E-mail novo volta a ser "não
 * verificado" (o `isDirty('email')` do Laravel).
 */
export async function updateProfile(
    user: Pick<UserRow, 'id' | 'email'>,
    input: { name: string; email: string; title: string | null; avatar_color: AvatarColor },
): Promise<UserRow> {
    await ensureEmailAvailable(input.email, user.id);

    const emailChanged = input.email !== user.email;

    try {
        return await db.transaction(async (tx) => {
            const [updated] = await tx
                .update(users)
                .set({
                    name: input.name,
                    email: input.email,
                    title: input.title,
                    avatarColor: input.avatar_color,
                    ...(emailChanged ? { emailVerifiedAt: null } : {}),
                })
                .where(eq(users.id, user.id))
                .returning();

            // Um link de redefinição pedido para o e-mail antigo não pode
            // sobreviver à troca: se outra conta assumir aquele endereço, o
            // link serviria para trocar a senha DELA.
            if (emailChanged) {
                await tx.delete(passwordResetTokens).where(eq(passwordResetTokens.email, user.email));
            }

            return updated;
        });
    } catch (error) {
        if (isUniqueViolation(error)) invalid('email', AUTH_MESSAGES.emailTaken);

        throw error;
    }
}

/**
 * Troca a senha conferindo a atual. Throttle de 6 por minuto por pessoa (o
 * `throttle:6,1` da rota): sem ele, uma sessão esquecida aberta viraria um
 * jeito de adivinhar a senha.
 */
export async function changePassword(
    user: Pick<UserRow, 'id' | 'password'>,
    input: { current_password: string; password: string },
): Promise<void> {
    await throttle(`password:${user.id}`, 6, 1);

    if (!(await verifyPassword(input.current_password, user.password))) {
        invalid('current_password', 'A senha atual está incorreta.');
    }

    await db
        .update(users)
        .set({ password: await hashPassword(input.password) })
        .where(eq(users.id, user.id));
}

/**
 * Exclui a conta, confirmada pela senha. O resto vai junto pelas chaves
 * estrangeiras (ON DELETE CASCADE): quadros de que a pessoa é dona — com
 * listas, cards e etiquetas —, participações, atribuições, comentários e
 * sessões. Nos quadros dos outros, a autoria de cards e atividades vira null.
 *
 * O token de redefinição é chave por e-mail, sem chave estrangeira: sai à
 * mão, senão valeria para quem se cadastrasse depois com o mesmo endereço.
 */
export async function deleteAccount(user: Pick<UserRow, 'id' | 'email' | 'password'>, password: string): Promise<void> {
    if (!(await verifyPassword(password, user.password))) {
        invalid('password', 'A senha está incorreta.');
    }

    await db.transaction(async (tx) => {
        await tx.delete(passwordResetTokens).where(eq(passwordResetTokens.email, user.email));
        await tx.delete(users).where(eq(users.id, user.id));
    });
}
