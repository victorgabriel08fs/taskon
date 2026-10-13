import 'server-only';

import { and, eq } from 'drizzle-orm';
import { db } from '@/server/db';
import { boardUser, users, type UserRow } from '@/server/db/schema';
import { HttpError, abort, invalid } from '@/server/errors';
import { authorizeBoard } from '@/server/policies/board';
import { logActivity } from '@/server/services/activity';
import { dropInvitation, inviteByEmail } from '@/server/services/invitations';

/**
 * Membros do quadro — o antigo `BoardMemberController`. Convidar e remover
 * são configurações do quadro: só owner/admin (`manage`).
 */

export type AddMemberResult =
    | { kind: 'added'; member: Pick<UserRow, 'id' | 'name'> }
    | { kind: 'invited'; email: string };

/**
 * Convida alguém para o quadro pelo e-mail. Quem já tem conta entra na hora;
 * quem não tem recebe um convite por e-mail (src/server/services/invitations.ts)
 * e entra quando aceitar. Devolve o que aconteceu, para o aviso.
 */
export async function addBoardMember(
    actor: Pick<UserRow, 'id'>,
    boardId: number,
    input: { email: string; role: 'admin' | 'member' },
    now = new Date(),
): Promise<AddMemberResult> {
    const { board } = await authorizeBoard(actor, boardId, 'manage');

    // Os e-mails são gravados em minúsculas, e o Postgres compara com caixa.
    const email = input.email.trim().toLowerCase();

    const [member] = await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

    if (!member) return { kind: 'invited', ...(await inviteByEmail(actor, board, { email, role: input.role }, now)) };

    await db.transaction(async (tx) => {
        // Quem decide se a pessoa já participa é o índice único (board_id,
        // user_id): dois convites simultâneos viram "já participa", não um
        // erro de banco.
        const inserted = await tx
            .insert(boardUser)
            .values({ boardId: board.id, userId: member.id, role: input.role })
            .onConflictDoNothing({ target: [boardUser.boardId, boardUser.userId] })
            .returning({ id: boardUser.id });

        if (inserted.length === 0) invalid('email', 'Essa pessoa já participa do quadro.');

        // Se ela tinha um convite pendente (criou a conta sem usar o link),
        // ele perdeu o sentido.
        await dropInvitation(board.id, email, tx);

        await logActivity(
            { boardId: board.id, userId: actor.id, type: 'member.added', description: `adicionou ${member.name} ao quadro` },
            tx,
        );
    });

    return { kind: 'added', member };
}

/**
 * Tira a pessoa do quadro. As atribuições dela nos cards ficam: o recorte
 * "minhas tarefas" (`assignedTo`) já ignora quadros de que a pessoa saiu, e se
 * ela voltar reencontra o que era dela.
 */
export async function removeBoardMember(actor: Pick<UserRow, 'id'>, boardId: number, userId: number): Promise<void> {
    const { board } = await authorizeBoard(actor, boardId, 'manage');

    const [member] = await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

    if (!member) abort(404);

    // 422 sem erro de campo: a mensagem vira toast. (No Laravel ela ia para o
    // campo `email`, que a lista de membros não mostra — o clique parecia não
    // fazer nada.)
    if (board.ownerId === member.id) throw new HttpError(422, 'O dono do quadro não pode ser removido.');

    await db.transaction(async (tx) => {
        const removed = await tx
            .delete(boardUser)
            .where(and(eq(boardUser.boardId, board.id), eq(boardUser.userId, member.id)))
            .returning({ id: boardUser.id });

        // Já tinha saído (clique duplo, outra aba): não há o que registrar.
        if (removed.length === 0) return;

        await logActivity(
            { boardId: board.id, userId: actor.id, type: 'member.removed', description: `removeu ${member.name} do quadro` },
            tx,
        );
    });
}
