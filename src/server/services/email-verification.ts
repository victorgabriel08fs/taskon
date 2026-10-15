import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, lte } from 'drizzle-orm';
import type { EmailVerificationPreview } from '@/types';
import { availableIn, hit, release } from '@/server/auth/rate-limit';
import { appUrl, config } from '@/server/config';
import { db, type Executor } from '@/server/db';
import { adminEvents, emailVerifications, users, type UserRow } from '@/server/db/schema';
import { HttpError } from '@/server/errors';
import { emailVerificationMail } from '@/server/mail/email-verification';
import { sendMail } from '@/server/mail/mailer';
import { isNativeAdminEmail } from '@/server/policies/admin';

/**
 * Confirmação de e-mail: a pessoa prova que a caixa de entrada é dela abrindo
 * o link que só chegou lá. É o que ativa o admin nativo (ver
 * src/server/policies/admin.ts): o cadastro não verifica e-mail e a lista dos
 * nativos está no código — público —, então sem esta prova qualquer um criaria
 * a conta com aquele endereço (ou trocaria o próprio e-mail para ele) e
 * viraria admin.
 *
 * O outro caminho que prova a caixa de entrada é a redefinição de senha
 * concluída (src/server/services/auth.ts → resetPassword); os dois terminam
 * em `markEmailVerified`.
 *
 * Como nas sessões, na redefinição de senha e nos convites, o token cru só
 * existe no e-mail — o banco guarda o SHA-256. O link vale
 * `config.admin.emailVerificationMinutes`, uma vez só, e só enquanto o e-mail
 * da conta for o do pedido: ele provou a caixa de entrada DAQUELE endereço.
 * Sem essa amarra, bastaria pedir o link no próprio e-mail, trocar o da conta
 * para o de um admin nativo no perfil e clicar.
 */

/** Intervalo mínimo entre dois links para a mesma conta — o mesmo do "Esqueci a senha". */
const RESEND_AFTER_SECONDS = 60;

/**
 * Teto de links por hora, por conta. Cada pedido manda um e-mail de verdade
 * (custo no Resend e reputação do domínio), e o intervalo de 60 s sozinho
 * ainda deixaria sair sessenta por hora.
 */
const MAX_PER_HOUR = 5;

export const EMAIL_VERIFICATION_MESSAGES = {
    invalid: 'Este link de confirmação não vale mais — ele pode ter expirado, já ter sido usado ou o e-mail da conta mudou. Peça um novo.',
    throttled: (seconds: number) =>
        `Acabamos de enviar um link. Confira sua caixa de entrada (e o spam) ou peça outro em ${seconds} ${seconds === 1 ? 'segundo' : 'segundos'}.`,
    hourly: (minutes: number) =>
        `Você já pediu ${MAX_PER_HOUR} links nesta hora. Confira sua caixa de entrada (e o spam) ou peça outro em ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}.`,
    mailFailed: 'Não conseguimos enviar o e-mail de confirmação agora. Tente de novo em instantes.',
} as const;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Formato do token gerado aqui (base64url de 32 bytes); qualquer outra coisa nem vai ao banco. */
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

/** Pedido feito antes disto já venceu. */
function validSince(now: Date): Date {
    return new Date(now.getTime() - config.admin.emailVerificationMinutes * 60_000);
}

/**
 * Manda para o e-mail da conta um link de confirmação novo — o anterior, se
 * houver, para de valer.
 *
 * O registro e o envio vão na MESMA transação: se o e-mail não sai, nada muda,
 * nem a cota da hora. Nem fica um pedido que ninguém recebeu (o intervalo
 * mínimo não prende a pessoa esperando por ele), nem o link que ela talvez já
 * tenha na caixa de entrada é invalidado por um que nunca chegou.
 */
export async function sendEmailVerification(
    user: Pick<UserRow, 'id' | 'name' | 'email'>,
    now = new Date(),
): Promise<{ email: string }> {
    const [previous] = await db
        .select({ createdAt: emailVerifications.createdAt })
        .from(emailVerifications)
        .where(eq(emailVerifications.userId, user.id))
        .limit(1);

    const waitMs = previous ? previous.createdAt.getTime() + RESEND_AFTER_SECONDS * 1000 - now.getTime() : 0;

    // 429, não 422: o pedido vem de um botão, sem campo onde mostrar o erro —
    // vira toast. E vem antes do teto por hora de propósito: um clique duplo
    // não pode gastar a cota da hora com links que nem seriam enviados.
    if (waitMs > 0) throw new HttpError(429, EMAIL_VERIFICATION_MESSAGES.throttled(Math.ceil(waitMs / 1000)));

    // A vaga da hora é reservada ANTES do envio, num incremento atômico, e
    // devolvida quando o link não sai (aqui e no catch lá embaixo): a cota
    // conta links, não tentativas. Conferir antes e contar só depois do envio
    // deixaria uma rajada de pedidos simultâneos passar inteira pela
    // conferência.
    const quota = `verify:${user.id}`;

    if ((await hit(quota, 3600, now)) > MAX_PER_HOUR) {
        const minutes = Math.ceil((await availableIn(quota, now)) / 60);

        await release(quota, now);

        throw new HttpError(429, EMAIL_VERIFICATION_MESSAGES.hourly(minutes));
    }

    const token = randomBytes(32).toString('base64url');
    const hashed = sha256(token);

    try {
        await db.transaction(async (tx) => {
            // O intervalo de 60 s decidido de novo, agora na própria gravação.
            // A leitura lá de cima é só o caminho rápido, e dois pedidos
            // simultâneos passam juntos por ela. Aqui o segundo espera a linha
            // do primeiro, presa até o fim desta transação (envio incluído),
            // e não troca o token que acabou de sair. Sem isso saíam dois
            // e-mails, e o link do primeiro já chegava morto.
            const [saved] = await tx
                .insert(emailVerifications)
                .values({ userId: user.id, email: user.email, token: hashed, createdAt: now })
                .onConflictDoUpdate({
                    target: emailVerifications.userId,
                    set: { email: user.email, token: hashed, createdAt: now },
                    setWhere: lte(emailVerifications.createdAt, new Date(now.getTime() - RESEND_AFTER_SECONDS * 1000)),
                })
                .returning({ userId: emailVerifications.userId });

            if (!saved) throw new HttpError(429, EMAIL_VERIFICATION_MESSAGES.throttled(RESEND_AFTER_SECONDS));

            await sendMail({
                to: user.email,
                toName: user.name,
                ...emailVerificationMail({
                    name: user.name,
                    email: user.email,
                    url: appUrl(`/verify-email/${token}`),
                    expiresInMinutes: config.admin.emailVerificationMinutes,
                }),
            });
        });
    } catch (error) {
        // Nenhum link saiu: a vaga reservada volta para a cota. Se nem isso
        // der certo, quem chama ainda recebe o erro original.
        await release(quota, now).catch(() => undefined);

        if (error instanceof HttpError) throw error;

        console.error('[email-verification] falha ao enviar o link de confirmação', error);

        throw new HttpError(500, EMAIL_VERIFICATION_MESSAGES.mailFailed);
    }

    return { email: user.email };
}

/**
 * O pedido em aberto do token, com a conta dona dele — ou null. Só vale
 * dentro do prazo e enquanto o e-mail da conta for o do pedido.
 */
async function validVerification(token: string, now: Date, executor: Executor = db) {
    if (!TOKEN_FORMAT.test(token)) return null;

    const [row] = await executor
        .select({
            token: emailVerifications.token,
            user: { id: users.id, name: users.name, email: users.email, emailVerifiedAt: users.emailVerifiedAt },
        })
        .from(emailVerifications)
        .innerJoin(users, eq(users.id, emailVerifications.userId))
        .where(
            and(
                eq(emailVerifications.token, sha256(token)),
                eq(emailVerifications.email, users.email),
                gt(emailVerifications.createdAt, validSince(now)),
            ),
        )
        .limit(1);

    return row ?? null;
}

/** O que a página /verify-email/[token] mostra antes de confirmar — ou null se o link não vale. */
export async function previewEmailVerification(token: string, now = new Date()): Promise<EmailVerificationPreview | null> {
    const row = await validVerification(token, now);

    return row ? { email: row.user.email, name: row.user.name } : null;
}

/**
 * Confirma o e-mail pelo token do link. Não pede sessão: o token só chega a
 * quem lê aquela caixa de entrada, e é exatamente isso que se quer provar.
 */
export async function confirmEmailVerification(
    token: string,
    now = new Date(),
): Promise<{ userId: number; becameNativeAdmin: boolean }> {
    return db.transaction(async (tx) => {
        const row = await validVerification(token, now, tx);

        if (!row) throw new HttpError(404, EMAIL_VERIFICATION_MESSAGES.invalid);

        // Apagar ANTES de marcar é a trava contra o uso duplo: dois cliques (ou
        // duas abas) disputam a mesma linha, e só quem a apagou segue. O token
        // entra no filtro para que um pedido novo, feito no meio do caminho,
        // não seja gasto pelo link antigo.
        const consumed = await tx
            .delete(emailVerifications)
            .where(and(eq(emailVerifications.userId, row.user.id), eq(emailVerifications.token, row.token)))
            .returning({ userId: emailVerifications.userId });

        if (consumed.length === 0) throw new HttpError(404, EMAIL_VERIFICATION_MESSAGES.invalid);

        const becameNativeAdmin = await markEmailVerified(tx, row.user, now);

        return { userId: row.user.id, becameNativeAdmin };
    });
}

/**
 * Marca o e-mail da conta como confirmado, dentro da transação de quem acabou
 * de provar a caixa de entrada (o link de confirmação ou a redefinição de
 * senha).
 *
 * Só grava se a conta ainda não estava confirmada E se o e-mail dela ainda é o
 * que foi provado: uma troca no perfil no meio do caminho zera a confirmação,
 * e o endereço novo ninguém provou. Quando o endereço é de admin nativo, a
 * confirmação É a ativação — e ativação de poder fica no histórico da
 * administração, com a própria conta como autora.
 *
 * Devolve se esta chamada ativou o admin nativo.
 */
export async function markEmailVerified(
    executor: Executor,
    user: Pick<UserRow, 'id' | 'name' | 'email' | 'emailVerifiedAt'>,
    now: Date,
): Promise<boolean> {
    if (user.emailVerifiedAt) return false;

    const [verified] = await executor
        .update(users)
        .set({ emailVerifiedAt: now })
        .where(and(eq(users.id, user.id), eq(users.email, user.email), isNull(users.emailVerifiedAt)))
        .returning({ id: users.id, name: users.name, email: users.email });

    if (!verified || !isNativeAdminEmail(verified.email)) return false;

    await executor.insert(adminEvents).values({
        actorId: verified.id,
        targetId: verified.id,
        targetName: verified.name,
        targetEmail: verified.email,
        type: 'admin.activated',
        createdAt: now,
    });

    return true;
}

/** Faxina noturna (cron de arquivamento): pedido vencido não confirma mais nada. */
export async function pruneExpiredEmailVerifications(now = new Date()): Promise<void> {
    await db.delete(emailVerifications).where(lte(emailVerifications.createdAt, validSince(now)));
}
