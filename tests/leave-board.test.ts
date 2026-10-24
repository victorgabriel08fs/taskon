import { and, asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Toast } from '@/types';
import { leaveBoard as leaveBoardAction } from '@/server/actions/boards';
import { db } from '@/server/db';
import { activities, boardUser, cardUser, type BoardRow, type UserRow } from '@/server/db/schema';
import { loadBoardPage } from '@/server/queries/board';
import { loadBoardsIndex } from '@/server/queries/boards-index';
import { LEAVE_MESSAGES, leaveBoard } from '@/server/services/members';
import { expectHttpError } from './support/assertions';
import * as factory from './support/factories';

/**
 * Sair do quadro: quem foi convidado (membro ou admin) sai por conta própria;
 * o dono não. A action roda de verdade — só a sessão, o cookie de flash e o
 * `refresh()` do Next são dublês, como em tests/cards.test.ts.
 */
const request = vi.hoisted(() => ({ user: null as UserRow | null, flashed: [] as Toast[] }));

vi.mock('@/server/auth/session', () => ({
    currentSession: async () => (request.user ? { user: request.user, session: { id: 'sessao-de-teste' } } : null),
}));
vi.mock('@/server/flash', () => ({
    flash: async (toast: Toast) => {
        request.flashed.push(toast);
    },
}));
vi.mock('next/cache', () => ({ refresh: vi.fn() }));

/** Para onde a action redirecionou, ou null. */
async function redirectOf(call: Promise<unknown>): Promise<string | null> {
    try {
        await call;
    } catch (error) {
        const digest = (error as { digest?: unknown }).digest;

        if (typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT')) return digest.split(';')[2] ?? null;

        throw error;
    }

    return null;
}

async function membership(board: Pick<BoardRow, 'id'>, user: Pick<UserRow, 'id'>) {
    const [row] = await db
        .select()
        .from(boardUser)
        .where(and(eq(boardUser.boardId, board.id), eq(boardUser.userId, user.id)));

    return row;
}

async function leftEntries(board: Pick<BoardRow, 'id'>) {
    return db
        .select()
        .from(activities)
        .where(and(eq(activities.boardId, board.id), eq(activities.type, 'member.left')))
        .orderBy(asc(activities.id));
}

beforeEach(() => {
    request.user = null;
    request.flashed.length = 0;
});

describe('sair do quadro (serviço)', () => {
    it('o membro sai, o quadro some da lista dele e o histórico registra', async () => {
        const owner = await factory.createUser();
        const board = await factory.createBoard(owner, { title: 'Lançamento' });
        const guest = await factory.createUser({ name: 'Bia Convidada' });
        await factory.addMember(board, guest);

        const left = await leaveBoard(guest, board.id);

        expect(left).toEqual({ id: board.id, title: 'Lançamento' });
        expect(await membership(board, guest)).toBeUndefined();
        expect((await loadBoardsIndex(guest)).boards).toHaveLength(0);

        const entries = await leftEntries(board);

        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ userId: guest.id, description: 'saiu do quadro' });

        // Quem fica continua vendo o quadro, agora sem a pessoa entre os membros.
        const { board: payload } = await loadBoardPage(owner, board.id);

        expect(payload.members.map((member) => member.id)).toEqual([owner.id]);
    });

    it('o admin também sai — o papel não prende ninguém ao quadro', async () => {
        const owner = await factory.createUser();
        const board = await factory.createBoard(owner);
        const admin = await factory.createUser();
        await factory.addMember(board, admin, 'admin');

        await leaveBoard(admin, board.id);

        expect(await membership(board, admin)).toBeUndefined();
    });

    it('depois de sair, abrir o quadro dá 403', async () => {
        const owner = await factory.createUser();
        const board = await factory.createBoard(owner);
        const guest = await factory.createUser();
        await factory.addMember(board, guest);

        await leaveBoard(guest, board.id);

        await expectHttpError(loadBoardPage(guest, board.id), 403);
    });

    it('mantém as atribuições da pessoa nos cards, como a remoção', async () => {
        const owner = await factory.createUser();
        const board = await factory.createBoard(owner);
        const guest = await factory.createUser();
        await factory.addMember(board, guest);
        const card = await factory.createCard(await factory.createList(board));
        await factory.assign(card, guest);

        await leaveBoard(guest, board.id);

        expect(await db.$count(cardUser, eq(cardUser.userId, guest.id))).toBe(1);
    });

    it('o dono não sai — o aviso vai para o toast, não para um campo', async () => {
        const owner = await factory.createUser();
        const board = await factory.createBoard(owner);

        const error = await expectHttpError(leaveBoard(owner, board.id), 422);

        expect(error.message).toBe(LEAVE_MESSAGES.owner);
        expect(error.errors).toBeUndefined();
        expect((await membership(board, owner))?.role).toBe('owner');
        expect(await leftEntries(board)).toHaveLength(0);
    });

    it('quem não participa recebe 403, e quadro inexistente dá 404', async () => {
        const board = await factory.createBoard(await factory.createUser());
        const stranger = await factory.createUser();

        await expectHttpError(leaveBoard(stranger, board.id), 403);
        await expectHttpError(leaveBoard(stranger, 999_999), 404);
    });

    it('a tela só oferece sair a quem não é o dono', async () => {
        const owner = await factory.createUser();
        const board = await factory.createBoard(owner);
        const guest = await factory.createUser();
        await factory.addMember(board, guest);

        expect((await loadBoardPage(owner, board.id)).board.can.leave).toBe(false);
        expect((await loadBoardPage(guest, board.id)).board.can.leave).toBe(true);
    });
});

describe('sair do quadro (action)', () => {
    it('volta para a lista de quadros com o aviso', async () => {
        const owner = await factory.createUser();
        const board = await factory.createBoard(owner, { title: 'Roadmap' });
        const guest = await factory.createUser();
        await factory.addMember(board, guest);
        request.user = guest;

        expect(await redirectOf(leaveBoardAction({ boardId: board.id }))).toBe('/boards');
        expect(request.flashed).toEqual([{ type: 'success', message: 'Você saiu do quadro "Roadmap".' }]);
        expect(await membership(board, guest)).toBeUndefined();
    });

    it('o dono recebe o motivo em toast e continua no quadro', async () => {
        const owner = await factory.createUser();
        const board = await factory.createBoard(owner);
        request.user = owner;

        const result = await leaveBoardAction({ boardId: board.id });

        expect(result).toEqual({ ok: false, status: 422, toast: { type: 'error', message: LEAVE_MESSAGES.owner } });
        expect(request.flashed).toEqual([]);
    });

    it('sem sessão é 401', async () => {
        const board = await factory.createBoard(await factory.createUser());

        expect(await leaveBoardAction({ boardId: board.id })).toMatchObject({ ok: false, status: 401 });
    });
});
