import 'server-only';

import { eq } from 'drizzle-orm';
import type { AdminEvent, AdminUserRow } from '@/types';
import { db, type Executor } from '@/server/db';
import { adminEvents, sessions, users, type UserRow } from '@/server/db/schema';
import { HttpError } from '@/server/errors';
import { adminAccess, adminCan, isNativeAdminEmail, type AdminSubject } from '@/server/policies/admin';

/**
 * A administração do Taskon: conceder e tirar admin, bloquear e desbloquear
 * contas — o que o painel /admin faz.
 *
 * Quem pode o quê é a tabela de src/server/policies/admin.ts. Este serviço
 * não repete a hierarquia: quem decide é `adminCan`, e daqui só sai a recusa
 * explicada em português. A tela usa a mesma política para esconder botões,
 * mas toda action é um endpoint público — a decisão que vale é a daqui.
 *
 * Cada operação é UMA transação com a linha de admin_events: mudança de poder
 * sem rastro não acontece. A conta alvo é travada (`FOR NO KEY UPDATE`) antes
 * da decisão, então dois cliques — ou dois admins — sobre a mesma conta entram
 * em fila: o segundo já enxerga o resultado do primeiro e é recusado como
 * redundante, sem evento repetido. E a decisão vale para o estado de agora, não
 * para o da tela: um admin concedido que viu "conta comum" não bloqueia quem
 * acabou de virar admin.
 */

/** As quatro operações do painel — as mesmas chaves do `can` de cada linha. */
export type AdminOperation = keyof AdminUserRow['can'];

/** A conta alvo como a decisão precisa dela (a política + o nome para o aviso). */
type Target = Pick<UserRow, 'id' | 'name' | 'email' | 'emailVerifiedAt' | 'isAdmin' | 'blockedAt'>;

/** O nome de cada operação no histórico. */
const EVENTS = {
    grant_admin: 'admin.granted',
    revoke_admin: 'admin.revoked',
    block: 'user.blocked',
    unblock: 'user.unblocked',
} as const satisfies Record<AdminOperation, AdminEvent['type']>;

/** As recusas, que viram toast. Exportadas para os testes conferirem o texto. */
export const ADMIN_MESSAGES = {
    /** Admin nativo que ainda não confirmou o e-mail: a tela de ativação explica o resto. */
    pending: 'Confirme o seu e-mail para ativar a administração do Taskon.',
    notFound: 'Essa conta não existe mais.',
    self: 'Você não pode alterar a própria conta pelo painel.',
    nativeTarget: {
        grant_admin: 'Contas com e-mail de admin nativo não mudam pelo painel.',
        revoke_admin: 'Contas com e-mail de admin nativo não mudam pelo painel.',
        block: 'Esta conta não pode ser bloqueada: o e-mail dela é de admin nativo.',
        unblock: 'Contas com e-mail de admin nativo não mudam pelo painel.',
    },
    nativeOnly: {
        grant_admin: 'Só o admin nativo pode conceder admin.',
        revoke_admin: 'Só o admin nativo pode tirar o admin de alguém.',
        block: 'Só o admin nativo pode bloquear outro admin.',
        unblock: 'Só o admin nativo pode desbloquear um admin.',
    },
    alreadyAdmin: (name: string) => `${name} já é admin.`,
    notAdmin: (name: string) => `${name} não é admin.`,
    blockedTarget: (name: string) => `Desbloqueie ${name} antes de conceder admin.`,
    alreadyBlocked: (name: string) => `${name} já está bloqueado(a).`,
    notBlocked: (name: string) => `${name} não está bloqueado(a).`,
} as const;

/** Dá admin a uma conta comum. Só o admin nativo. */
export async function grantAdmin(viewer: AdminSubject, userId: number, now = new Date()): Promise<{ name: string }> {
    return administer(viewer, userId, 'grant_admin', now, async (tx, target) => {
        await tx.update(users).set({ isAdmin: true }).where(eq(users.id, target.id));
    });
}

/** Tira o admin concedido (inclusive de quem está bloqueado). Só o admin nativo. */
export async function revokeAdmin(viewer: AdminSubject, userId: number, now = new Date()): Promise<{ name: string }> {
    return administer(viewer, userId, 'revoke_admin', now, async (tx, target) => {
        await tx.update(users).set({ isAdmin: false }).where(eq(users.id, target.id));
    });
}

/**
 * Bloqueia a conta e derruba TODAS as sessões dela: sem a linha em sessions,
 * a próxima requisição de qualquer aba ou aparelho já chega como visitante, e
 * o login passa a recusar. Nada mais muda — quadros, cards e participações
 * ficam como estão, e o `is_admin` de um admin bloqueado também (ele só não
 * entra; desbloqueado, volta como era).
 */
export async function blockUser(viewer: AdminSubject, userId: number, now = new Date()): Promise<{ name: string }> {
    return administer(viewer, userId, 'block', now, async (tx, target) => {
        await tx.update(users).set({ blockedAt: now, blockedBy: viewer.id }).where(eq(users.id, target.id));
        await tx.delete(sessions).where(eq(sessions.userId, target.id));
    });
}

/** Desbloqueia: a pessoa volta a entrar (com a senha de sempre — as sessões antigas não voltam). */
export async function unblockUser(viewer: AdminSubject, userId: number, now = new Date()): Promise<{ name: string }> {
    return administer(viewer, userId, 'unblock', now, async (tx, target) => {
        await tx.update(users).set({ blockedAt: null, blockedBy: null }).where(eq(users.id, target.id));
    });
}

/**
 * A casca das quatro operações: confere quem pede, trava e confere o alvo,
 * aplica a mudança e grava o histórico — tudo na mesma transação.
 */
async function administer(
    viewer: AdminSubject,
    userId: number,
    operation: AdminOperation,
    now: Date,
    apply: (tx: Executor, target: Target) => Promise<void>,
): Promise<{ name: string }> {
    // Antes de procurar o alvo: quem não administra recebe o mesmo 403 com
    // qualquer id, sem descobrir pela diferença 403/404 quais contas existem.
    authorizeAdmin(viewer);

    return db.transaction(async (tx) => {
        const [target] = await tx
            .select({
                id: users.id,
                name: users.name,
                email: users.email,
                emailVerifiedAt: users.emailVerifiedAt,
                isAdmin: users.isAdmin,
                blockedAt: users.blockedAt,
            })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1)
            // NO KEY: as colunas que mudam não são chave, então a trava não
            // segura quem só aponta para a conta (um card novo, um login).
            .for('no key update');

        if (!target) throw new HttpError(404, ADMIN_MESSAGES.notFound);

        if (!adminCan(viewer, target)[operation]) throw refusal(operation, viewer, target);

        await apply(tx, target);

        // Nome e e-mail copiados: o histórico continua legível se a conta for
        // excluída depois (target_id vira null).
        await tx.insert(adminEvents).values({
            actorId: viewer.id,
            targetId: target.id,
            targetName: target.name,
            targetEmail: target.email,
            type: EVENTS[operation],
            createdAt: now,
        });

        return { name: target.name };
    });
}

/** Só admin ATIVO (nativo confirmado ou concedido, sem bloqueio) usa o painel. */
function authorizeAdmin(viewer: AdminSubject): void {
    const access = adminAccess(viewer);

    if (access === 'native' || access === 'admin') return;

    // O nativo pendente sabe que é nativo (a tela de ativação diz); os outros
    // ficam com o 403 genérico — para eles, o painel nem existe.
    throw new HttpError(403, access === 'pending' ? ADMIN_MESSAGES.pending : undefined);
}

/**
 * O porquê de `adminCan` ter recusado — só a mensagem e o status: a decisão
 * já foi tomada pela política. 403 quando a hierarquia não deixa; 422 quando
 * a operação não faz sentido no estado da conta (redundante, ou conceder
 * admin a quem está bloqueado).
 */
function refusal(operation: AdminOperation, viewer: AdminSubject, target: Target): HttpError {
    if (target.id === viewer.id) return new HttpError(403, ADMIN_MESSAGES.self);

    if (isNativeAdminEmail(target.email)) return new HttpError(403, ADMIN_MESSAGES.nativeTarget[operation]);

    const native = adminAccess(viewer) === 'native';
    const blocked = target.blockedAt !== null;

    switch (operation) {
        case 'grant_admin':
            if (!native) return new HttpError(403, ADMIN_MESSAGES.nativeOnly.grant_admin);
            if (target.isAdmin) return new HttpError(422, ADMIN_MESSAGES.alreadyAdmin(target.name));
            if (blocked) return new HttpError(422, ADMIN_MESSAGES.blockedTarget(target.name));
            break;
        case 'revoke_admin':
            if (!native) return new HttpError(403, ADMIN_MESSAGES.nativeOnly.revoke_admin);
            if (!target.isAdmin) return new HttpError(422, ADMIN_MESSAGES.notAdmin(target.name));
            break;
        case 'block':
            if (!native && target.isAdmin) return new HttpError(403, ADMIN_MESSAGES.nativeOnly.block);
            if (blocked) return new HttpError(422, ADMIN_MESSAGES.alreadyBlocked(target.name));
            break;
        case 'unblock':
            if (!native && target.isAdmin) return new HttpError(403, ADMIN_MESSAGES.nativeOnly.unblock);
            if (!blocked) return new HttpError(422, ADMIN_MESSAGES.notBlocked(target.name));
            break;
    }

    // A política recusou por um motivo que as linhas acima não conhecem (a
    // tabela mudou e a explicação ficou para trás): recusa do mesmo jeito.
    return new HttpError(403);
}
