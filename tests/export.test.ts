import { refresh } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadExportDetails as loadExportDetailsAction } from '@/server/actions/export';
import { db } from '@/server/db';
import { checklistItems, checklists, comments, type BoardListRow, type BoardRow, type UserRow } from '@/server/db/schema';
import { loadExportDetails } from '@/server/queries/card';
import { expectHttpError } from './support/assertions';
import { addMember, createBoard, createCard, createList, createUser } from './support/factories';

/**
 * O detalhe da exportação (o CardExportTest do Laravel): o que a tela de
 * exportação busca para conseguir escrever descrição, checklist e comentário
 * no texto do prompt.
 *
 * "Fica fora do primeiro carregamento" agora é garantido pelo desenho: o
 * detalhe não faz parte dos dados da página do quadro — só chega pela action
 * `loadExportDetails`, quando alguém abre a exportação.
 */
const request = vi.hoisted(() => ({ user: null as UserRow | null }));

vi.mock('@/server/auth/session', () => ({
    currentSession: async () => (request.user ? { user: request.user, session: { id: 'sessao-de-teste' } } : null),
}));
vi.mock('next/cache', () => ({ refresh: vi.fn() }));

let board: BoardRow;
let user: UserRow;
let todo: BoardListRow;

beforeEach(async () => {
    user = await createUser();
    board = await createBoard(user);
    todo = await createList(board, { position: 1 });

    request.user = user;
    vi.mocked(refresh).mockClear();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('detalhe da exportação', () => {
    it('traz descrição, checklists e comentários', async () => {
        const card = await createCard(todo, { position: 1, description: 'Precisa suportar Google.' });

        const [checklist] = await db.insert(checklists).values({ cardId: card.id, title: 'Backend', position: 1 }).returning();

        await db.insert(checklistItems).values([
            { checklistId: checklist!.id, content: 'validar token', isDone: false, position: 2 },
            { checklistId: checklist!.id, content: 'criar rota', isDone: true, position: 1 },
        ]);
        await db.insert(comments).values({ cardId: card.id, userId: user.id, body: 'Vamos de OAuth.' });

        const [detail] = await loadExportDetails(user, board.id);

        expect(detail).toMatchObject({
            id: card.id,
            description: 'Precisa suportar Google.',
            checklists: [
                {
                    title: 'Backend',
                    items: [
                        { content: 'criar rota', is_done: true },
                        { content: 'validar token', is_done: false },
                    ],
                },
            ],
            comments: [{ author: user.name, body: 'Vamos de OAuth.' }],
        });

        // O detalhe é um complemento do card que já veio no quadro: repetir
        // título e prazo aqui dobraria o payload sem acrescentar nada.
        expect(Object.keys(detail!)).toEqual(['id', 'description', 'checklists', 'comments']);
        expect(Object.keys(detail!.checklists[0]!)).toEqual(['title', 'items']);
        expect(Object.keys(detail!.comments[0]!)).toEqual(['author', 'body', 'created_at']);
    });

    it('a conversa vem do começo para o fim, com a data no fuso do app', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });

        const colleague = await createUser({ name: 'Bia' });

        await addMember(board, colleague);

        const card = await createCard(todo);

        vi.setSystemTime(new Date('2026-10-12T15:00:00Z'));
        await db.insert(comments).values({ cardId: card.id, userId: colleague.id, body: 'Primeiro' });
        vi.setSystemTime(new Date('2026-10-12T16:00:00Z'));
        await db.insert(comments).values({ cardId: card.id, userId: user.id, body: 'Segundo' });

        const [detail] = await loadExportDetails(user, board.id);

        expect(detail?.comments).toEqual([
            { author: 'Bia', body: 'Primeiro', created_at: '2026-10-12T12:00:00-03:00' },
            { author: user.name, body: 'Segundo', created_at: '2026-10-12T13:00:00-03:00' },
        ]);
    });

    it('card sem nada além do título vem com listas vazias', async () => {
        const card = await createCard(todo);

        expect(await loadExportDetails(user, board.id)).toEqual([
            { id: card.id, description: null, checklists: [], comments: [] },
        ]);
    });

    it('os arquivados ficam de fora', async () => {
        await createCard(todo, { position: 1, title: 'Viva' });
        await createCard(todo, { position: 2, title: 'Arquivada', archivedAt: new Date() });

        expect(await loadExportDetails(user, board.id)).toHaveLength(1);
    });

    it('cards de outros quadros ficam de fora', async () => {
        const mine = await createCard(todo);

        await createCard(await createList(await createBoard(user)));

        expect((await loadExportDetails(user, board.id)).map((detail) => detail.id)).toEqual([mine.id]);
    });

    it('quem é de fora do quadro não recebe nada', async () => {
        await createCard(todo, { position: 1 });

        await expectHttpError(loadExportDetails(await createUser(), board.id), 403);
        await expectHttpError(loadExportDetails(user, 999_999), 404);
    });

    it('a action só lê: não re-renderiza a página', async () => {
        const card = await createCard(todo);

        expect(await loadExportDetailsAction({ boardId: board.id })).toEqual({
            ok: true,
            data: [{ id: card.id, description: null, checklists: [], comments: [] }],
        });
        expect(refresh).not.toHaveBeenCalled();

        request.user = await createUser();

        expect(await loadExportDetailsAction({ boardId: board.id })).toMatchObject({ ok: false, status: 403 });
    });
});
