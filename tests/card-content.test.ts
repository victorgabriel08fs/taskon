import { and, asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Toast } from '@/types';
import {
    addChecklist as addChecklistAction,
    addChecklistItem as addChecklistItemAction,
    addComment as addCommentAction,
    createLabel as createLabelAction,
    updateChecklistItem as updateChecklistItemAction,
    updateLabel as updateLabelAction,
} from '@/server/actions/card-content';
import { db } from '@/server/db';
import {
    activities,
    cardLabel,
    checklistItems,
    checklists,
    comments,
    labels,
    type BoardListRow,
    type BoardRow,
    type CardRow,
    type UserRow,
} from '@/server/db/schema';
import * as checklistService from '@/server/services/checklists';
import * as commentService from '@/server/services/comments';
import * as labelService from '@/server/services/labels';
import { expectHttpError } from './support/assertions';
import { addMember, attachLabel, createBoard, createCard, createLabel, createList, createUser } from './support/factories';

/**
 * O que mora dentro do card: comentários, checklists e etiquetas (os antigos
 * CommentController, ChecklistController e LabelController).
 */
const request = vi.hoisted(() => ({ user: null as UserRow | null }));

vi.mock('@/server/auth/session', () => ({
    currentSession: async () => (request.user ? { user: request.user, session: { id: 'sessao-de-teste' } } : null),
}));
vi.mock('@/server/flash', () => ({ flash: async (_toast: Toast) => {} }));
vi.mock('next/cache', () => ({ refresh: vi.fn() }));

let board: BoardRow;
let owner: UserRow;
let member: UserRow;
let list: BoardListRow;
let card: CardRow;

beforeEach(async () => {
    owner = await createUser();
    member = await createUser();
    board = await createBoard(owner);
    await addMember(board, member, 'member');
    list = await createList(board);
    card = await createCard(list, { title: 'Revisar contrato' });

    request.user = owner;
});

describe('comentários', () => {
    it('qualquer membro comenta, e o histórico do card registra', async () => {
        const { id } = await commentService.addComment(member, card.id, { body: 'Olhei a cláusula 3.' });

        const [comment] = await db.select().from(comments).where(eq(comments.id, id));

        expect(comment).toMatchObject({ cardId: card.id, userId: member.id, body: 'Olhei a cláusula 3.' });

        const [activity] = await db.select().from(activities).where(eq(activities.cardId, card.id));

        expect(activity).toMatchObject({
            type: 'comment.created',
            description: 'comentou em Revisar contrato',
            userId: member.id,
        });
    });

    it('só o autor apaga o próprio comentário', async () => {
        const { id } = await commentService.addComment(member, card.id, { body: 'Meu' });

        // Nem o dono do quadro apaga a fala dos outros.
        await expectHttpError(commentService.deleteComment(owner, id), 403);

        await commentService.deleteComment(member, id);

        expect(await db.select().from(comments).where(eq(comments.id, id))).toEqual([]);
    });

    it('quem é de fora não comenta nem apaga; comentário que sumiu é 404', async () => {
        const stranger = await createUser();
        const { id } = await commentService.addComment(owner, card.id, { body: 'Oi' });

        await expectHttpError(commentService.addComment(stranger, card.id, { body: 'Intruso' }), 403);
        await expectHttpError(commentService.deleteComment(stranger, id), 403);
        await expectHttpError(commentService.deleteComment(owner, 999_999), 404);
        await expectHttpError(commentService.addComment(owner, 999_999, { body: 'Nada' }), 404);
    });

    it('a action valida o texto (obrigatório, até 5000)', async () => {
        expect(await addCommentAction({ cardId: card.id, body: '   ' })).toMatchObject({
            status: 422,
            errors: { body: 'Preencha este campo.' },
        });
        expect(await addCommentAction({ cardId: card.id, body: 'x'.repeat(5001) })).toMatchObject({
            status: 422,
            errors: { body: 'Use no máximo 5000 caracteres.' },
        });
        expect(await addCommentAction({ cardId: card.id, body: '  Pronto.  ' })).toEqual({ ok: true, data: null });

        const [comment] = await db.select().from(comments).where(eq(comments.cardId, card.id));

        expect(comment?.body).toBe('Pronto.');
    });
});

describe('checklists', () => {
    it('nova checklist e novo item entram no fim', async () => {
        const first = await checklistService.addChecklist(member, card.id, { title: 'Antes' });
        const second = await checklistService.addChecklist(member, card.id, { title: 'Depois' });

        const rows = await db
            .select({ id: checklists.id, position: checklists.position })
            .from(checklists)
            .where(eq(checklists.cardId, card.id))
            .orderBy(asc(checklists.position));

        expect(rows).toEqual([
            { id: first.id, position: 1 },
            { id: second.id, position: 2 },
        ]);

        await checklistService.addChecklistItem(member, first.id, { content: 'a' });
        await checklistService.addChecklistItem(member, first.id, { content: 'b' });

        const items = await db
            .select({ content: checklistItems.content, position: checklistItems.position, isDone: checklistItems.isDone })
            .from(checklistItems)
            .where(eq(checklistItems.checklistId, first.id))
            .orderBy(asc(checklistItems.position));

        expect(items).toEqual([
            { content: 'a', position: 1, isDone: false },
            { content: 'b', position: 2, isDone: false },
        ]);

        // Checklist é miúda demais para o histórico do quadro.
        expect(await db.select().from(activities)).toEqual([]);
    });

    it('marcar o item não mexe no texto, e vice-versa', async () => {
        const { id: checklistId } = await checklistService.addChecklist(owner, card.id, { title: 'Passos' });
        const { id } = await checklistService.addChecklistItem(owner, checklistId, { content: 'Ler' });

        const item = async () => (await db.select().from(checklistItems).where(eq(checklistItems.id, id)))[0];

        await checklistService.updateChecklistItem(member, id, { is_done: true });
        expect(await item()).toMatchObject({ content: 'Ler', isDone: true });

        await checklistService.updateChecklistItem(member, id, { content: 'Ler tudo' });
        expect(await item()).toMatchObject({ content: 'Ler tudo', isDone: true });
    });

    it('apagar a checklist leva os itens junto', async () => {
        const { id: checklistId } = await checklistService.addChecklist(owner, card.id, { title: 'Passos' });
        const { id: itemId } = await checklistService.addChecklistItem(owner, checklistId, { content: 'Ler' });
        const { id: otherId } = await checklistService.addChecklistItem(owner, checklistId, { content: 'Assinar' });

        await checklistService.deleteChecklistItem(member, itemId);
        expect((await db.select().from(checklistItems)).map((row) => row.id)).toEqual([otherId]);

        await checklistService.deleteChecklist(member, checklistId);
        expect(await db.select().from(checklists)).toEqual([]);
        expect(await db.select().from(checklistItems)).toEqual([]);
    });

    it('quem é de fora não mexe; o que sumiu é 404', async () => {
        const stranger = await createUser();
        const { id: checklistId } = await checklistService.addChecklist(owner, card.id, { title: 'Passos' });
        const { id: itemId } = await checklistService.addChecklistItem(owner, checklistId, { content: 'Ler' });

        await expectHttpError(checklistService.addChecklist(stranger, card.id, { title: 'X' }), 403);
        await expectHttpError(checklistService.deleteChecklist(stranger, checklistId), 403);
        await expectHttpError(checklistService.addChecklistItem(stranger, checklistId, { content: 'X' }), 403);
        await expectHttpError(checklistService.updateChecklistItem(stranger, itemId, { is_done: true }), 403);
        await expectHttpError(checklistService.deleteChecklistItem(stranger, itemId), 403);

        await expectHttpError(checklistService.deleteChecklist(owner, 999_999), 404);
        await expectHttpError(checklistService.updateChecklistItem(owner, 999_999, { is_done: true }), 404);
    });

    it('as actions validam título (até 120) e texto do item (até 500)', async () => {
        expect(await addChecklistAction({ cardId: card.id, title: 'x'.repeat(121) })).toMatchObject({
            status: 422,
            errors: { title: 'Use no máximo 120 caracteres.' },
        });

        const { id: checklistId } = await checklistService.addChecklist(owner, card.id, { title: 'Passos' });

        expect(await addChecklistItemAction({ checklistId, content: '' })).toMatchObject({
            status: 422,
            errors: { content: 'Preencha este campo.' },
        });

        const { id } = await checklistService.addChecklistItem(owner, checklistId, { content: 'Ler' });

        // `content` enviado tem de ter texto; ausente, fica como está.
        expect(await updateChecklistItemAction({ itemId: id, content: ' ' })).toMatchObject({
            status: 422,
            errors: { content: 'Preencha este campo.' },
        });
        expect(await updateChecklistItemAction({ itemId: id, is_done: true })).toEqual({ ok: true, data: null });

        const [item] = await db.select().from(checklistItems).where(eq(checklistItems.id, id));

        expect(item).toMatchObject({ content: 'Ler', isDone: true });
    });
});

describe('etiquetas', () => {
    it('dono e admin criam, renomeiam e apagam; membro comum não', async () => {
        const admin = await createUser();

        await addMember(board, admin, 'admin');

        const { id } = await labelService.createLabel(admin, board.id, { name: 'Cliente', color: 'sky' });

        await labelService.updateLabel(owner, id, { name: null });
        expect((await db.select().from(labels).where(eq(labels.id, id)))[0]).toMatchObject({ name: null, color: 'sky' });

        await labelService.updateLabel(owner, id, { color: 'lime' });
        expect((await db.select().from(labels).where(eq(labels.id, id)))[0]).toMatchObject({ name: null, color: 'lime' });

        await expectHttpError(labelService.createLabel(member, board.id, { name: 'X', color: 'rose' }), 403);
        await expectHttpError(labelService.updateLabel(member, id, { name: 'X' }), 403);
        await expectHttpError(labelService.deleteLabel(member, id), 403);

        await labelService.deleteLabel(admin, id);
        expect(await db.select().from(labels).where(eq(labels.id, id))).toEqual([]);
    });

    it('apagar a etiqueta a tira de todos os cards', async () => {
        const label = await createLabel(board);

        await attachLabel(card, label);
        await labelService.deleteLabel(owner, label.id);

        expect(await db.select().from(cardLabel).where(and(eq(cardLabel.cardId, card.id)))).toEqual([]);
    });

    it('etiqueta que sumiu é 404; quadro de outra pessoa é 403', async () => {
        const foreignBoard = await createBoard(await createUser());

        await expectHttpError(labelService.updateLabel(owner, 999_999, { name: 'X' }), 404);
        await expectHttpError(labelService.createLabel(owner, foreignBoard.id, { name: 'X', color: 'rose' }), 403);
    });

    it('as actions aceitam só as cores da paleta; o nome é opcional (até 60)', async () => {
        expect(await createLabelAction({ boardId: board.id, name: 'X', color: 'chartreuse' as never })).toMatchObject({
            status: 422,
            errors: { color: 'Escolha uma das opções oferecidas.' },
        });
        expect(await createLabelAction({ boardId: board.id, name: 'x'.repeat(61), color: 'rose' })).toMatchObject({
            status: 422,
            errors: { name: 'Use no máximo 60 caracteres.' },
        });
        expect(await createLabelAction({ boardId: board.id, name: '   ', color: 'rose' })).toEqual({ ok: true, data: null });

        const [label] = await db.select().from(labels).where(eq(labels.boardId, board.id));

        expect(label).toMatchObject({ name: null, color: 'rose' });

        // `color` enviado não pode ser vazio; ausente, fica como está.
        expect(await updateLabelAction({ labelId: label!.id, color: null as never })).toMatchObject({
            status: 422,
            errors: { color: 'Escolha uma das opções oferecidas.' },
        });
        expect(await updateLabelAction({ labelId: label!.id, name: 'Urgente' })).toEqual({ ok: true, data: null });
        expect((await db.select().from(labels).where(eq(labels.id, label!.id)))[0]).toMatchObject({
            name: 'Urgente',
            color: 'rose',
        });
    });
});
