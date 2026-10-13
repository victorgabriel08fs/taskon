import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import { and, asc, eq, gt, lte } from 'drizzle-orm';
import type { BoardBackground, BoardInvitation, InvitationPreview } from '@/types';
import { toAppIso } from '@/lib/timezone';
import { throttle } from '@/server/auth/rate-limit';
import { appUrl, config } from '@/server/config';
import { db, type Executor } from '@/server/db';
import { boardInvitations, boardUser, boards, users, type BoardRow, type UserRow } from '@/server/db/schema';
import { HttpError, abort } from '@/server/errors';
import { boardInvitationMail } from '@/server/mail/board-invitation';
import { sendMail } from '@/server/mail/mailer';
import { authorizeBoard } from '@/server/policies/board';
import { logActivity } from '@/server/services/activity';

/**
 * Convites por e-mail para quem ainda NÃO tem conta.
 *
 * Quem já tem conta entra direto no quadro (src/server/services/members.ts);
 * os outros recebem um e-mail com um link `/invite/<token>`. O link vale
 * `config.invitations.expiresInDays` dias e uma vez só: aceitar põe a pessoa
 * no quadro com o papel escolhido e apaga o convite.
 *
 * O token é a credencial: 32 bytes aleatórios que só existem no e-mail — o
 * banco guarda o SHA-256, como nas sessões e na redefinição de senha. Por isso
 * o convite NÃO é aceito sozinho quando alguém se cadastra com o mesmo e-mail:
 * o app não verifica e-mail, e qualquer um poderia criar a conta com o
 * endereço de outra pessoa para herdar os quadros dela. Sem o link, não entra.
 */

type Role = 'admin' | 'member';

export const INVITATION_MESSAGES = {
    invalid: 'Este convite não vale mais — ele pode ter expirado, sido cancelado ou já usado. Peça um novo a quem convidou.',
    mailFailed: 'Não consegui enviar o e-mail do convite. Tente de novo em instantes.',
} as const;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Formato do token gerado aqui (base64url de 32 bytes); qualquer outra coisa nem vai ao banco. */
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

function expiresAt(now: Date): Date {
    return new Date(now.getTime() + config.invitations.expiresInDays * 86_400_000);
}

/**
 * Cria (ou renova) o convite e manda o e-mail. Chamado depois que a permissão
 * de `manage` já foi conferida por quem chama.
 *
 * Convidar de novo o mesmo e-mail reaproveita a linha: token e prazo novos, e
 * o link anterior deixa de valer. Tudo numa transação COM o envio: se o e-mail
 * não sai, nada muda — nem o convite novo aparece como pendente, nem o link
 * antigo de um reenvio é invalidado por um novo que ninguém recebeu.
 */
export async function inviteByEmail(
    actor: Pick<UserRow, 'id'>,
    board: Pick<BoardRow, 'id' | 'title'>,
    input: { email: string; role: Role },
    now = new Date(),
): Promise<{ email: string }> {
    await throttle(`invite:${actor.id}`, config.invitations.maxPerHour, 60);

    const email = input.email.trim().toLowerCase();
    const token = randomBytes(32).toString('base64url');

    const [inviter] = await db.select({ name: users.name }).from(users).where(eq(users.id, actor.id)).limit(1);

    try {
        await db.transaction(async (tx) => {
            const [existing] = await tx
                .select({ id: boardInvitations.id })
                .from(boardInvitations)
                .where(and(eq(boardInvitations.boardId, board.id), eq(boardInvitations.email, email)))
                .limit(1);

            await tx
                .insert(boardInvitations)
                .values({
                    boardId: board.id,
                    email,
                    role: input.role,
                    token: sha256(token),
                    invitedBy: actor.id,
                    expiresAt: expiresAt(now),
                })
                .onConflictDoUpdate({
                    target: [boardInvitations.boardId, boardInvitations.email],
                    set: { role: input.role, token: sha256(token), invitedBy: actor.id, expiresAt: expiresAt(now) },
                });

            // Só o primeiro convite vai para o histórico; reenviar é ruído.
            if (!existing) {
                await logActivity(
                    { boardId: board.id, userId: actor.id, type: 'member.invited', description: `convidou ${email} para o quadro` },
                    tx,
                );
            }

            await sendMail({
                to: email,
                ...boardInvitationMail({
                    inviterName: inviter?.name ?? null,
                    boardTitle: board.title,
                    role: input.role,
                    url: appUrl(`/invite/${token}`),
                    expiresInDays: config.invitations.expiresInDays,
                }),
            });
        });
    } catch (error) {
        if (error instanceof HttpError) throw error;

        console.error('[invitations] falha ao convidar', error);

        throw new HttpError(500, INVITATION_MESSAGES.mailFailed);
    }

    return { email };
}

/** O convite pelo id, já com a permissão de administrar o quadro dele conferida. */
async function managedInvitation(actor: Pick<UserRow, 'id'>, invitationId: number) {
    const [invitation] = await db.select().from(boardInvitations).where(eq(boardInvitations.id, invitationId)).limit(1);

    if (!invitation) abort(404);

    const { board } = await authorizeBoard(actor, invitation.boardId, 'manage');

    return { invitation, board };
}

/** Manda o convite de novo (token e prazo novos; o link antigo para de valer). */
export async function resendInvitation(
    actor: Pick<UserRow, 'id'>,
    invitationId: number,
    now = new Date(),
): Promise<{ email: string }> {
    const { invitation, board } = await managedInvitation(actor, invitationId);

    return inviteByEmail(actor, board, { email: invitation.email, role: invitation.role as Role }, now);
}

/** Cancela o convite: o link para de valer na hora. */
export async function revokeInvitation(actor: Pick<UserRow, 'id'>, invitationId: number): Promise<{ email: string }> {
    const { invitation, board } = await managedInvitation(actor, invitationId);

    await db.transaction(async (tx) => {
        const removed = await tx
            .delete(boardInvitations)
            .where(eq(boardInvitations.id, invitation.id))
            .returning({ id: boardInvitations.id });

        // Já tinha sido aceito ou cancelado em outra aba: nada a registrar.
        if (removed.length === 0) return;

        await logActivity(
            {
                boardId: board.id,
                userId: actor.id,
                type: 'member.invite_revoked',
                description: `cancelou o convite de ${invitation.email}`,
            },
            tx,
        );
    });

    return { email: invitation.email };
}

/** Os convites pendentes do quadro, para a lista de membros (só quem administra a vê). */
export async function pendingInvitations(boardId: number, now = new Date(), executor: Executor = db): Promise<BoardInvitation[]> {
    const rows = await executor
        .select({
            id: boardInvitations.id,
            email: boardInvitations.email,
            role: boardInvitations.role,
            inviter: users.name,
            createdAt: boardInvitations.createdAt,
            expiresAt: boardInvitations.expiresAt,
        })
        .from(boardInvitations)
        .leftJoin(users, eq(users.id, boardInvitations.invitedBy))
        .where(and(eq(boardInvitations.boardId, boardId), gt(boardInvitations.expiresAt, now)))
        .orderBy(asc(boardInvitations.createdAt), asc(boardInvitations.id));

    return rows.map((row) => ({
        id: row.id,
        email: row.email,
        role: row.role as Role,
        invited_by: row.inviter,
        created_at: toAppIso(row.createdAt) ?? '',
        expires_at: toAppIso(row.expiresAt) ?? '',
    }));
}

/** O convite válido do token, com o quadro e quem convidou — ou null. */
async function validInvitation(token: string, now: Date, executor: Executor = db) {
    if (!TOKEN_FORMAT.test(token)) return null;

    const [row] = await executor
        .select({
            invitation: boardInvitations,
            boardTitle: boards.title,
            boardBackground: boards.background,
            inviter: users.name,
        })
        .from(boardInvitations)
        .innerJoin(boards, eq(boards.id, boardInvitations.boardId))
        .leftJoin(users, eq(users.id, boardInvitations.invitedBy))
        .where(and(eq(boardInvitations.token, sha256(token)), gt(boardInvitations.expiresAt, now)))
        .limit(1);

    return row ?? null;
}

/** O que a página /invite/[token] mostra a quem abriu o link — ou null se ele não vale. */
export async function previewInvitation(token: string, now = new Date()): Promise<InvitationPreview | null> {
    const row = await validInvitation(token, now);

    if (!row) return null;

    return {
        board_title: row.boardTitle,
        board_background: row.boardBackground as BoardBackground,
        email: row.invitation.email,
        role: row.invitation.role as Role,
        invited_by: row.inviter,
        expires_at: toAppIso(row.invitation.expiresAt) ?? '',
    };
}

/**
 * Aceita o convite: a pessoa entra no quadro com o papel do convite e o
 * convite deixa de existir. Quem já participava só "gasta" o convite — sem
 * erro e sem mexer no papel que já tinha.
 *
 * Não exige que o e-mail da conta seja o do convite: o token só chega a quem
 * recebeu o e-mail, e é comum aceitar com outro endereço (o do trabalho, o
 * pessoal). Quem convidou vê a pessoa entrar no histórico do quadro.
 */
export async function acceptInvitation(
    user: Pick<UserRow, 'id'>,
    token: string,
    now = new Date(),
): Promise<{ boardId: number; boardTitle: string; alreadyMember: boolean }> {
    return db.transaction(async (tx) => {
        const row = await validInvitation(token, now, tx);

        if (!row) throw new HttpError(404, INVITATION_MESSAGES.invalid);

        const { invitation } = row;

        // Apagar primeiro é a trava contra o uso duplo: dois cliques (ou duas
        // abas) disputam a mesma linha, e só quem a apagou segue.
        const consumed = await tx
            .delete(boardInvitations)
            .where(eq(boardInvitations.id, invitation.id))
            .returning({ id: boardInvitations.id });

        if (consumed.length === 0) throw new HttpError(404, INVITATION_MESSAGES.invalid);

        const joined = await tx
            .insert(boardUser)
            .values({ boardId: invitation.boardId, userId: user.id, role: invitation.role, lastOpenedAt: now })
            .onConflictDoNothing({ target: [boardUser.boardId, boardUser.userId] })
            .returning({ id: boardUser.id });

        if (joined.length > 0) {
            await logActivity(
                {
                    boardId: invitation.boardId,
                    userId: user.id,
                    type: 'member.joined',
                    description: row.inviter ? `entrou no quadro pelo convite de ${row.inviter}` : 'entrou no quadro pelo convite',
                },
                tx,
            );
        }

        return { boardId: invitation.boardId, boardTitle: row.boardTitle, alreadyMember: joined.length === 0 };
    });
}

/** Quem acabou de entrar no quadro por outro caminho não precisa mais do convite pendente. */
export async function dropInvitation(boardId: number, email: string, executor: Executor = db): Promise<void> {
    await executor
        .delete(boardInvitations)
        .where(and(eq(boardInvitations.boardId, boardId), eq(boardInvitations.email, email.trim().toLowerCase())));
}

/** Faxina noturna (cron de arquivamento): convite vencido não serve para nada. */
export async function pruneExpiredInvitations(now = new Date()): Promise<void> {
    await db.delete(boardInvitations).where(lte(boardInvitations.expiresAt, now));
}
