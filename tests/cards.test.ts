import { and, asc, eq } from 'drizzle-orm';
import { refresh } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Toast } from '@/types';
import { createCard as createCardAction, deleteCard as deleteCardAction, moveCard as moveCardAction, updateCard as updateCardAction } from '@/server/actions/cards';
import { db } from '@/server/db';
import {
    activities,
    boardLists,
    cardLabel,
    cardUser,
    cards,
    checklistItems,
    checklists,
    comments,
    type BoardListRow,
    type BoardRow,
    type UserRow,
} from '@/server/db/schema';
import { loadCardDetail } from '@/server/queries/card';
import * as cardService from '@/server/services/cards';
import { expectHttpError } from './support/assertions';
import { addMember, attachLabel, assign, createBoard, createCard, createLabel, createList, createUser, fresh } from './support/factories';

/**
 * CardTest e CompletionTest do Laravel, no nível do serviço — mais o deep link
 * do card (o antigo `activeCard`) e a casca fina das actions.
 *
 * As actions rodam de verdade (validação, toast, redirect); só a sessão, o
 * cookie de flash e o `refresh()` do Next são trocados por dublês, porque
 * dependem de uma requisição.
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

/** Para onde a action redirecionou (o `assertRedirect` do Laravel), ou null. */
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

async function cardIdsIn(list: BoardListRow): Promise<number[]> {
    const rows = await db
        .select({ id: cards.id })
        .from(cards)
        .where(eq(cards.boardListId, list.id))
        .orderBy(asc(cards.position), asc(cards.id));

    return rows.map((row) => row.id);
}

async function activityTypes(cardId: number): Promise<string[]> {
    const rows = await db
        .select({ type: activities.type })
        .from(activities)
        .where(eq(activities.cardId, cardId))
        .orderBy(asc(activities.id));

    return rows.map((row) => row.type);
}

let board: BoardRow;
let user: UserRow;
let todo: BoardListRow;
let doing: BoardListRow;

beforeEach(async () => {
    user = await createUser();
    board = await createBoard(user);
    todo = await createList(board, { title: 'A fazer', position: 1 });
    doing = await createList(board, { title: 'Fazendo', position: 2 });

    request.user = user;
    request.flashed.length = 0;
    vi.mocked(refresh).mockClear();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('cards', () => {
    it('entra no fim da lista', async () => {
        await createCard(todo, { position: 1 });

        const { id } = await cardService.createCard(user, todo.id, { title: 'Segundo card' });
        const card = await fresh({ id });

        expect(card?.boardListId).toBe(todo.id);
        expect(card?.boardId).toBe(board.id);
        expect(card?.position).toBeCloseTo(2.0, 3);
        expect(card?.createdBy).toBe(user.id);
    });

    it('conta os arquivados ao achar o fim da lista', async () => {
        await createCard(todo, { position: 1 });
        await createCard(todo, { position: 5, archivedAt: new Date() });

        const { id } = await cardService.createCard(user, todo.id, { title: 'Depois do arquivado' });

        expect((await fresh({ id }))?.position).toBeCloseTo(6.0, 3);
    });

    it('quem cria o card já é membro dele', async () => {
        // Sem isso o card nasce sem dono e some do "só os meus", do painel e do
        // resumo diário de quem acabou de escrevê-lo.
        const { id } = await cardService.createCard(user, todo.id, { title: 'Nasce comigo' });

        const members = await db.select({ userId: cardUser.userId }).from(cardUser).where(eq(cardUser.cardId, id));

        expect(members.map((row) => row.userId)).toEqual([user.id]);
    });

    it('registra a criação no histórico, com o nome da lista', async () => {
        const { id } = await cardService.createCard(user, todo.id, { title: 'Escrever testes' });

        const [activity] = await db.select().from(activities).where(eq(activities.cardId, id));

        expect(activity?.type).toBe('card.created');
        expect(activity?.description).toBe('adicionou Escrever testes em A fazer');
        expect(activity?.userId).toBe(user.id);
    });

    it('mover para outra lista reescreve a ordem', async () => {
        const first = await createCard(doing, { position: 1 });
        const second = await createCard(doing, { position: 2 });
        const moved = await createCard(todo, { position: 1 });

        await cardService.moveCard(user, moved.id, {
            board_list_id: doing.id,
            ordered_ids: [first.id, moved.id, second.id],
        });

        expect((await fresh(moved))?.boardListId).toBe(doing.id);
        expect(await cardIdsIn(doing)).toEqual([first.id, moved.id, second.id]);
        expect((await fresh(second))?.position).toBe(3);
        expect(await activityTypes(moved.id)).toEqual(['card.moved']);
    });

    it('ignora ids que não estão na lista de destino', async () => {
        const mine = await createCard(doing, { position: 1 });
        const elsewhere = await createCard(todo, { position: 7 });

        await cardService.moveCard(user, mine.id, {
            board_list_id: doing.id,
            ordered_ids: [elsewhere.id, mine.id, 999_999, 3_000_000_000, -4],
        });

        // O card de outra lista não ganha posição nem muda de lugar.
        expect(await fresh(elsewhere)).toMatchObject({ boardListId: todo.id, position: 7 });
        expect((await fresh(mine))?.position).toBe(2);

        // Reordenar dentro da mesma lista não vira "moveu" no histórico.
        expect(await activityTypes(mine.id)).toEqual([]);
    });

    it('id repetido vale pela última aparição; id fracionário é ignorado', async () => {
        const first = await createCard(doing, { position: 1 });
        const second = await createCard(doing, { position: 2 });
        const moved = await createCard(todo, { position: 1 });

        await cardService.moveCard(user, moved.id, {
            board_list_id: doing.id,
            ordered_ids: [first.id, moved.id, second.id, first.id, 1.5],
        });

        expect(await cardIdsIn(doing)).toEqual([moved.id, second.id, first.id]);
        expect((await fresh(first))?.position).toBe(4);
    });

    it('não move para uma lista de outro quadro', async () => {
        const foreignList = await createList(await createBoard(await createUser()));
        const card = await createCard(todo, { position: 1 });

        await expectHttpError(
            cardService.moveCard(user, card.id, { board_list_id: foreignList.id, ordered_ids: [card.id] }),
            422,
            'board_list_id',
        );

        expect((await fresh(card))?.boardListId).toBe(todo.id);
    });

    it('concluir registra no histórico', async () => {
        const card = await createCard(todo, { position: 1 });

        await cardService.updateCard(user, card.id, { is_completed: true });

        expect((await fresh(card))?.completedAt).not.toBeNull();

        const [activity] = await db
            .select()
            .from(activities)
            .where(and(eq(activities.cardId, card.id), eq(activities.type, 'card.completed')));

        expect(activity?.description).toBe(`concluiu ${card.title}`);
    });

    it('reabrir limpa a conclusão e registra no histórico', async () => {
        const card = await createCard(todo, { position: 1, completedAt: new Date() });

        await cardService.updateCard(user, card.id, { is_completed: false });

        expect((await fresh(card))?.completedAt).toBeNull();
        expect(await activityTypes(card.id)).toEqual(['card.reopened']);
    });

    it('só os campos enviados mudam; null limpa', async () => {
        const card = await createCard(todo, {
            title: 'Original',
            description: 'Texto',
            coverColor: 'rose',
            dueAt: new Date('2026-10-20T15:00:00Z'),
        });

        await cardService.updateCard(user, card.id, { title: 'Renomeado' });

        expect(await fresh(card)).toMatchObject({ title: 'Renomeado', description: 'Texto', coverColor: 'rose' });

        await cardService.updateCard(user, card.id, { description: null, cover_color: null, due_at: null });

        expect(await fresh(card)).toMatchObject({ title: 'Renomeado', description: null, coverColor: null, dueAt: null });

        // Editar texto não é concluir: nada de histórico.
        expect(await activityTypes(card.id)).toEqual([]);
    });

    it('marca e desmarca etiquetas, só do próprio quadro', async () => {
        const card = await createCard(todo, { position: 1 });
        const label = await createLabel(board, { name: 'Urgente', color: 'rose' });
        const foreignLabel = await createLabel(await createBoard(await createUser()), { name: 'X', color: 'blue' });

        const attached = async () =>
            (
                await db
                    .select()
                    .from(cardLabel)
                    .where(and(eq(cardLabel.cardId, card.id), eq(cardLabel.labelId, label.id)))
            ).length > 0;

        await cardService.toggleCardLabel(user, card.id, label.id);
        expect(await attached()).toBe(true);

        await cardService.toggleCardLabel(user, card.id, label.id);
        expect(await attached()).toBe(false);

        await expectHttpError(cardService.toggleCardLabel(user, card.id, foreignLabel.id), 404);
    });

    it('atribui e desatribui só quem é membro do quadro', async () => {
        const card = await createCard(todo, { position: 1 });
        const colleague = await createUser();
        const stranger = await createUser();

        await addMember(board, colleague);

        const assigned = async () =>
            (
                await db
                    .select()
                    .from(cardUser)
                    .where(and(eq(cardUser.cardId, card.id), eq(cardUser.userId, colleague.id)))
            ).length > 0;

        await cardService.toggleCardMember(user, card.id, colleague.id);
        expect(await assigned()).toBe(true);

        await cardService.toggleCardMember(user, card.id, colleague.id);
        expect(await assigned()).toBe(false);

        await expectHttpError(cardService.toggleCardMember(user, card.id, stranger.id), 404);
    });

    it('excluir apaga o card e avisa no histórico do quadro', async () => {
        const card = await createCard(todo, { position: 1 });

        const result = await cardService.deleteCard(user, card.id);

        expect(result).toEqual({ boardId: board.id, title: card.title });
        expect(await fresh(card)).toBeUndefined();

        const [activity] = await db.select().from(activities).where(eq(activities.type, 'card.deleted'));

        expect(activity).toMatchObject({ boardId: board.id, cardId: null, description: `excluiu ${card.title}` });
    });

    it('quem é de fora não mexe em cards', async () => {
        const card = await createCard(todo, { position: 1 });
        const stranger = await createUser();

        await expectHttpError(cardService.updateCard(stranger, card.id, { title: 'Hackeado' }), 403);
        expect((await fresh(card))?.title).not.toBe('Hackeado');

        await expectHttpError(cardService.createCard(stranger, todo.id, { title: 'Intruso' }), 403);
        await expectHttpError(cardService.deleteCard(stranger, card.id), 403);
        await expectHttpError(
            cardService.moveCard(stranger, card.id, { board_list_id: doing.id, ordered_ids: [card.id] }),
            403,
        );
    });

    it('card ou lista que não existe é 404', async () => {
        await expectHttpError(cardService.updateCard(user, 999_999, { title: 'Nada' }), 404);
        await expectHttpError(cardService.createCard(user, 999_999, { title: 'Nada' }), 404);
    });
});

/**
 * A coluna de conclusão (`board_lists.is_done`): só o CRUZAMENTO da fronteira
 * mexe em `completed_at`.
 */
describe('coluna de conclusão', () => {
    let done: BoardListRow;

    beforeEach(async () => {
        done = await createList(board, { title: 'Concluído', position: 3, isDone: true });
    });

    it('arrastar para a coluna de conclusão conclui o card', async () => {
        const card = await createCard(todo);

        await cardService.moveCard(user, card.id, { board_list_id: done.id, ordered_ids: [card.id] });

        expect((await fresh(card))?.completedAt).not.toBeNull();
        expect(await activityTypes(card.id)).toEqual(['card.moved', 'card.completed']);
    });

    it('tirar da coluna de conclusão reabre o card', async () => {
        const card = await createCard(done, { completedAt: new Date(Date.now() - 3_600_000) });

        await cardService.moveCard(user, card.id, { board_list_id: todo.id, ordered_ids: [card.id] });

        expect((await fresh(card))?.completedAt).toBeNull();
        expect(await activityTypes(card.id)).toEqual(['card.moved', 'card.reopened']);
    });

    it('mover entre colunas comuns não desfaz a conclusão manual', async () => {
        const card = await createCard(todo);

        // Concluída na caixinha do modal, sem sair da coluna.
        await cardService.updateCard(user, card.id, { is_completed: true });
        await cardService.moveCard(user, card.id, { board_list_id: doing.id, ordered_ids: [card.id] });

        expect((await fresh(card))?.completedAt, 'arrastar não pode desfazer a decisão manual').not.toBeNull();
    });

    it('chegar concluído à coluna de conclusão mantém a data original', async () => {
        const completedAt = new Date('2026-10-01T12:00:00Z');
        const card = await createCard(todo, { completedAt });

        await cardService.moveCard(user, card.id, { board_list_id: done.id, ordered_ids: [card.id] });

        expect((await fresh(card))?.completedAt?.toISOString()).toBe(completedAt.toISOString());
    });

    it('a data de conclusão é a do relógio da aplicação', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-12T15:00:00Z'));

        const card = await createCard(todo);

        await cardService.moveCard(user, card.id, { board_list_id: done.id, ordered_ids: [card.id] });

        expect((await fresh(card))?.completedAt?.toISOString()).toBe('2026-10-12T15:00:00.000Z');
    });
});

describe('detalhe do card (deep link)', () => {
    it('traz lista, etiquetas, membros, comentários, checklists e histórico', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-12T15:00:00Z'));

        const colleague = await createUser({ name: 'Ana Lima' });

        await addMember(board, colleague);

        const card = await createCard(todo, {
            title: 'Integrar login',
            description: 'Com Google.',
            coverColor: 'violet',
            dueAt: new Date('2026-10-20T13:00:00Z'),
        });
        const label = await createLabel(board);

        await attachLabel(card, label);
        await assign(card, colleague);

        await db.insert(comments).values({ cardId: card.id, userId: colleague.id, body: 'Primeiro' });
        vi.setSystemTime(new Date('2026-10-12T16:00:00Z'));
        await db.insert(comments).values({ cardId: card.id, userId: user.id, body: 'Segundo' });

        const [late] = await db.insert(checklists).values({ cardId: card.id, title: 'Depois', position: 2 }).returning();
        const [early] = await db.insert(checklists).values({ cardId: card.id, title: 'Antes', position: 1 }).returning();

        await db.insert(checklistItems).values([
            { checklistId: early!.id, content: 'b', isDone: true, position: 2 },
            { checklistId: early!.id, content: 'a', isDone: false, position: 1 },
        ]);

        await cardService.updateCard(user, card.id, { is_completed: true });

        const detail = await loadCardDetail(user, board.id, card.id);

        expect(detail).toMatchObject({
            id: card.id,
            board_id: board.id,
            board_list_id: todo.id,
            list_title: 'A fazer',
            title: 'Integrar login',
            description: 'Com Google.',
            cover_color: 'violet',
            due_at: '2026-10-20T10:00:00-03:00',
            completed_at: '2026-10-12T13:00:00-03:00',
            archived_at: null,
            label_ids: [label.id],
            member_ids: [colleague.id],
        });

        // Conversa do mais recente para o mais antigo; só o autor apaga.
        expect(detail.comments.map((comment) => [comment.body, comment.author.name, comment.can_delete])).toEqual([
            ['Segundo', user.name, true],
            ['Primeiro', 'Ana Lima', false],
        ]);
        expect(detail.comments[1]?.author).toMatchObject({ id: colleague.id, initials: 'AL' });
        expect(detail.comments[0]?.author).not.toHaveProperty('password');

        expect(detail.checklists.map((checklist) => checklist.title)).toEqual(['Antes', 'Depois']);
        expect(detail.checklists[0]?.items.map((item) => [item.content, item.is_done])).toEqual([
            ['a', false],
            ['b', true],
        ]);
        expect(detail.checklists[1]).toEqual({ id: late!.id, title: 'Depois', position: 2, items: [] });

        expect(detail.activities.map((activity) => activity.type)).toEqual(['card.completed']);
        expect(detail.activities[0]?.user?.id).toBe(user.id);
    });

    it('mostra só as 20 atividades mais recentes', async () => {
        const card = await createCard(todo);

        for (let index = 1; index <= 25; index++) {
            await db.insert(activities).values({
                boardId: board.id,
                cardId: card.id,
                userId: user.id,
                type: 'card.moved',
                description: `passo ${index}`,
                createdAt: new Date(Date.UTC(2026, 9, 1, 0, index)),
            });
        }

        const detail = await loadCardDetail(user, board.id, card.id);

        expect(detail.activities).toHaveLength(20);
        expect(detail.activities[0]?.description).toBe('passo 25');
        expect(detail.activities[19]?.description).toBe('passo 6');
    });

    it('um card arquivado continua abrindo, com archived_at', async () => {
        const card = await createCard(todo, { archivedAt: new Date('2026-10-10T12:00:00Z') });

        const detail = await loadCardDetail(user, board.id, card.id);

        expect(detail.archived_at).toBe('2026-10-10T09:00:00-03:00');
    });

    it('card de outro quadro é 404; quem é de fora leva 403', async () => {
        const otherBoard = await createBoard(user);
        const foreign = await createCard(await createList(otherBoard));
        const card = await createCard(todo);

        await expectHttpError(loadCardDetail(user, board.id, foreign.id), 404);
        await expectHttpError(loadCardDetail(user, board.id, 999_999), 404);
        await expectHttpError(loadCardDetail(await createUser(), board.id, card.id), 403);
    });
});

describe('actions de card', () => {
    it('excluir volta para o quadro, não para a URL do card', async () => {
        const card = await createCard(todo, { title: 'Some daqui' });

        expect(await redirectOf(deleteCardAction({ cardId: card.id }))).toBe(`/boards/${board.id}`);
        expect(request.flashed).toEqual([{ type: 'success', message: '"Some daqui" foi excluído.' }]);
        expect(await fresh(card)).toBeUndefined();
    });

    it('criar devolve o id e re-renderiza a página', async () => {
        const result = await createCardAction({ listId: todo.id, title: '  Com espaços  ' });

        expect(result.ok).toBe(true);

        const id = result.ok ? result.data.id : 0;

        expect((await fresh({ id }))?.title).toBe('Com espaços');
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('valida o título', async () => {
        const empty = await createCardAction({ listId: todo.id, title: '   ' });
        const long = await updateCardAction({ cardId: (await createCard(todo)).id, title: 'x'.repeat(501) });

        expect(empty).toMatchObject({ ok: false, status: 422, errors: { title: 'Preencha este campo.' } });
        expect(long).toMatchObject({ ok: false, status: 422, errors: { title: 'Use no máximo 500 caracteres.' } });
    });

    it('lê o prazo do datetime-local no fuso do app, e "" tira o prazo', async () => {
        const card = await createCard(todo);

        await updateCardAction({ cardId: card.id, due_at: '2026-10-12T14:30' });
        expect((await fresh(card))?.dueAt?.toISOString()).toBe('2026-10-12T17:30:00.000Z');

        await updateCardAction({ cardId: card.id, due_at: '' });
        expect((await fresh(card))?.dueAt).toBeNull();

        expect(await updateCardAction({ cardId: card.id, due_at: 'amanhã' })).toMatchObject({
            status: 422,
            errors: { due_at: 'Informe uma data válida.' },
        });
    });

    it('aceita só as cores da paleta (e null tira a capa)', async () => {
        const card = await createCard(todo, { coverColor: 'rose' });

        expect(await updateCardAction({ cardId: card.id, cover_color: 'chartreuse' as never })).toMatchObject({
            status: 422,
            errors: { cover_color: 'Escolha uma das opções oferecidas.' },
        });

        await updateCardAction({ cardId: card.id, cover_color: null });
        expect((await fresh(card))?.coverColor).toBeNull();
    });

    it('mover exige a ordem e uma lista do quadro', async () => {
        const card = await createCard(todo);

        expect(await moveCardAction({ cardId: card.id, board_list_id: doing.id, ordered_ids: [] })).toMatchObject({
            status: 422,
            errors: { ordered_ids: 'Preencha este campo.' },
        });

        const foreign = await createList(await createBoard(await createUser()));

        expect(
            await moveCardAction({ cardId: card.id, board_list_id: foreign.id, ordered_ids: [card.id] }),
        ).toMatchObject({ status: 422, errors: { board_list_id: 'Escolha uma lista deste quadro.' } });

        const moved = await moveCardAction({ cardId: card.id, board_list_id: doing.id, ordered_ids: [card.id] });

        expect(moved).toEqual({ ok: true, data: null });
        expect((await fresh(card))?.boardListId).toBe(doing.id);
    });

    it('sem sessão é 401; de fora é 403 com aviso', async () => {
        const card = await createCard(todo);

        request.user = null;
        expect(await updateCardAction({ cardId: card.id, title: 'x' })).toMatchObject({ ok: false, status: 401 });

        request.user = await createUser();
        expect(await updateCardAction({ cardId: card.id, title: 'x' })).toMatchObject({
            ok: false,
            status: 403,
            toast: { type: 'error', message: 'Você não tem permissão para fazer isso.' },
        });
    });

    it('lista que sumiu: 404 e a página atualizada', async () => {
        await db.delete(boardLists).where(eq(boardLists.id, todo.id));

        expect(await createCardAction({ listId: todo.id, title: 'Órfão' })).toMatchObject({ ok: false, status: 404 });
        expect(refresh).toHaveBeenCalledTimes(1);
    });
});
