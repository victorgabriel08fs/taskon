import { isValidElement, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { UserRow } from '@/server/db/schema';
import { addMember, createBoard, createCard, createList, createUser } from '../support/factories';

/**
 * Paridade, no nível da PÁGINA, com os GETs do BoardTest/CardTest legados:
 * `get('/boards/{id}')->assertForbidden()/assertOk()` e o deep link do card.
 * O layout e a página do App Router são chamados como funções (Server
 * Components são funções async); só a sessão é dublê.
 */
const request = vi.hoisted(() => ({ user: null as UserRow | null }));

vi.mock('@/server/auth/session', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/server/auth/session')>()),
    currentUser: async () => request.user,
    requireUser: async () => {
        if (!request.user) throw Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/login;307;' });

        return request.user;
    },
}));
vi.mock('next/cache', () => ({ refresh: vi.fn() }));

/** O digest do erro de controle do Next (notFound, redirect), ou null se não lançou. */
async function digestOf(call: Promise<unknown>): Promise<string | null> {
    try {
        await call;
    } catch (error) {
        const digest = (error as { digest?: unknown }).digest;

        if (typeof digest === 'string') return digest;

        throw error;
    }

    return null;
}

const params = (boardId: string) => ({ params: Promise.resolve({ boardId }), children: null });

describe('GET /boards/{id}', () => {
    it('test_non_members_cannot_open_a_board: quem é de fora vê a tela de 403', async () => {
        const { default: BoardLayout } = await import('@/app/(app)/boards/[boardId]/layout');
        const { Forbidden } = await import('@/components/forbidden');
        const board = await createBoard(await createUser());

        request.user = await createUser();

        const element = (await BoardLayout(params(String(board.id)))) as ReactElement;

        expect(isValidElement(element)).toBe(true);
        expect(element.type).toBe(Forbidden);
    });

    it('test_members_can_open_a_board: o membro recebe o quadro', async () => {
        const { default: BoardLayout } = await import('@/app/(app)/boards/[boardId]/layout');
        const board = await createBoard(await createUser());
        const member = await createUser();

        await addMember(board, member, 'member');
        request.user = member;

        const element = (await BoardLayout(params(String(board.id)))) as ReactElement<{ board: { id: number } }>;

        expect(element.props.board.id).toBe(board.id);
    });

    it('quadro inexistente ou id inválido é 404', async () => {
        const { default: BoardLayout } = await import('@/app/(app)/boards/[boardId]/layout');

        request.user = await createUser();

        expect(await digestOf(BoardLayout(params('999999')))).toMatch(/^NEXT_HTTP_ERROR_FALLBACK;404/);
        expect(await digestOf(BoardLayout(params('abc')))).toMatch(/^NEXT_HTTP_ERROR_FALLBACK;404/);
    });
});

describe('GET /boards/{board}/cards/{card}', () => {
    it('card de outro quadro é 404 (o abort(404) do BoardController@show)', async () => {
        const { default: CardPage } = await import('@/app/(app)/boards/[boardId]/cards/[cardId]/page');
        const owner = await createUser();
        const board = await createBoard(owner);
        const other = await createBoard(owner);
        const foreign = await createCard(await createList(other));

        request.user = owner;

        expect(
            await digestOf(CardPage({ params: Promise.resolve({ boardId: String(board.id), cardId: String(foreign.id) }) })),
        ).toMatch(/^NEXT_HTTP_ERROR_FALLBACK;404/);
    });

    it('o card do quadro abre (activeCard)', async () => {
        const { default: CardPage } = await import('@/app/(app)/boards/[boardId]/cards/[cardId]/page');
        const owner = await createUser();
        const board = await createBoard(owner);
        const card = await createCard(await createList(board), { title: 'Abrir' });

        request.user = owner;

        const element = (await CardPage({
            params: Promise.resolve({ boardId: String(board.id), cardId: String(card.id) }),
        })) as ReactElement<{ card: { id: number; title: string } }>;

        expect(element.props.card).toMatchObject({ id: card.id, title: 'Abrir' });
    });
});
