import { and, asc, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/server/db';
import {
    activities,
    boardLists,
    boardUser,
    boards,
    cardUser,
    checklistItems,
    checklists,
    comments,
    labels,
    type BoardRow,
    type UserRow,
} from '@/server/db/schema';
import { loadBoardActivity, loadBoardPage, loadBoardTitle } from '@/server/queries/board';
import { loadBoardsIndex } from '@/server/queries/boards-index';
import { createBoard, deleteBoard, toggleFavorite, updateBoard } from '@/server/services/boards';
import { addBoardMember, removeBoardMember } from '@/server/services/members';
import { expectHttpError } from './support/assertions';
import * as factory from './support/factories';

/**
 * Quadros, membros e as consultas das telas de quadro — o BoardTest do
 * Laravel, mais os pedaços do CardTest, CompletionTest e AutoArchiveTest que
 * olham para o payload do quadro e para as configurações dele.
 */

afterEach(() => {
    vi.useRealTimers();
});

const freeze = (iso: string) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(iso));
};

async function membership(board: Pick<BoardRow, 'id'>, user: Pick<UserRow, 'id'>) {
    const [row] = await db
        .select()
        .from(boardUser)
        .where(and(eq(boardUser.boardId, board.id), eq(boardUser.userId, user.id)));

    return row;
}

async function boardRow(board: Pick<BoardRow, 'id'>) {
    const [row] = await db.select().from(boards).where(eq(boards.id, board.id));

    return row;
}

async function activitiesOf(board: Pick<BoardRow, 'id'>, type: string) {
    return db
        .select()
        .from(activities)
        .where(and(eq(activities.boardId, board.id), eq(activities.type, type)))
        .orderBy(asc(activities.id));
}

describe('lista de quadros', () => {
    it('mostra só os quadros de que a pessoa participa', async () => {
        const user = await factory.createUser();
        const mine = await factory.createBoard(user, { title: 'Meu quadro' });
        await factory.createBoard(await factory.createUser(), { title: 'Quadro de outra pessoa' });

        const { boards: summaries, backgrounds } = await loadBoardsIndex(user);

        expect(summaries).toHaveLength(1);
        expect(summaries[0]!.id).toBe(mine.id);
        expect(backgrounds).toEqual(['aurora', 'sunset', 'ocean', 'forest', 'candy', 'midnight', 'ember', 'graphite']);
    });

    it('deixa de fora os quadros arquivados', async () => {
        const user = await factory.createUser();
        await factory.createBoard(user, { archivedAt: new Date() });
        const live = await factory.createBoard(user);

        const { boards: summaries } = await loadBoardsIndex(user);

        expect(summaries.map((summary) => summary.id)).toEqual([live.id]);
    });

    it('põe favoritos primeiro, depois o aberto por último e, nunca abertos, os mais novos', async () => {
        const user = await factory.createUser();
        const at = (iso: string) => new Date(iso);

        const neverOpenedOld = await factory.createBoard(user, { createdAt: at('2026-01-01T12:00:00Z') });
        const openedEarlier = await factory.createBoard(user, { createdAt: at('2026-01-02T12:00:00Z') });
        const favorite = await factory.createBoard(user, { createdAt: at('2026-01-03T12:00:00Z') });
        const neverOpenedNew = await factory.createBoard(user, { createdAt: at('2026-01-04T12:00:00Z') });
        const openedLater = await factory.createBoard(user, { createdAt: at('2026-01-05T12:00:00Z') });

        const pivot = (board: BoardRow, values: Partial<typeof boardUser.$inferInsert>) =>
            db
                .update(boardUser)
                .set(values)
                .where(and(eq(boardUser.boardId, board.id), eq(boardUser.userId, user.id)));

        await pivot(neverOpenedOld, { lastOpenedAt: null });
        await pivot(openedEarlier, { lastOpenedAt: at('2026-02-05T12:00:00Z') });
        await pivot(favorite, { lastOpenedAt: at('2026-02-01T12:00:00Z'), isFavorite: true });
        await pivot(neverOpenedNew, { lastOpenedAt: null });
        await pivot(openedLater, { lastOpenedAt: at('2026-02-06T12:00:00Z') });

        const { boards: summaries } = await loadBoardsIndex(user);

        // No Postgres um DESC simples poria os nunca abertos (NULL) no topo.
        expect(summaries.map((summary) => summary.id)).toEqual([
            favorite.id,
            openedLater.id,
            openedEarlier.id,
            neverOpenedNew.id,
            neverOpenedOld.id,
        ]);
    });

    it('resume cada quadro com o papel, o favorito e o último acesso da própria pessoa', async () => {
        const owner = await factory.createUser({ name: 'Ana Dona' });
        const admin = await factory.createUser({ name: 'Bruno Admin' });
        const board = await factory.createBoard(owner, { title: 'Produto', description: 'Roadmap', background: 'ocean' });
        await factory.addMember(board, admin, 'admin');
        await db
            .update(boardUser)
            .set({ isFavorite: true, lastOpenedAt: new Date('2026-10-12T17:30:00Z') })
            .where(and(eq(boardUser.boardId, board.id), eq(boardUser.userId, admin.id)));

        const { boards: summaries } = await loadBoardsIndex(admin);

        expect(summaries[0]).toEqual({
            id: board.id,
            title: 'Produto',
            description: 'Roadmap',
            background: 'ocean',
            is_favorite: true,
            role: 'admin',
            last_opened_at: '2026-10-12T14:30:00-03:00',
            lists_count: 0,
            cards_count: 0,
            done_count: 0,
            members: [
                expect.objectContaining({ id: owner.id, name: 'Ana Dona', initials: 'AD', role: 'owner' }),
                expect.objectContaining({ id: admin.id, name: 'Bruno Admin', initials: 'BA', role: 'admin' }),
            ],
        });
        expect(summaries[0]!.members[0]).not.toHaveProperty('password');
    });

    it('conta listas vivas e mede o progresso pelo recorte que sobrevive ao arquivamento', async () => {
        const user = await factory.createUser();
        const board = await factory.createBoard(user);
        const todo = await factory.createList(board);
        const done = await factory.createList(board, { isDone: true });
        await factory.createList(board, { archivedAt: new Date() });

        const long = new Date('2026-01-01T12:00:00Z');

        for (let i = 0; i < 3; i++) await factory.createCard(todo);
        for (let i = 0; i < 2; i++) await factory.createCard(done, { completedAt: long });

        // Concluídos e arquivados: continuam valendo como conquista.
        for (let i = 0; i < 2; i++) await factory.createCard(done, { completedAt: long, archivedAt: new Date() });

        // Arquivado SEM concluir foi abandonado: sai dos dois lados da conta.
        await factory.createCard(todo, { archivedAt: new Date() });

        const { boards: summaries } = await loadBoardsIndex(user);

        expect(summaries[0]).toMatchObject({ lists_count: 2, cards_count: 7, done_count: 4 });
    });

    it('arquivar os concluídos não desfaz o progresso do quadro', async () => {
        // Quadro fechado: dez tarefas, dez concluídas há muito tempo e já
        // varridas para a gaveta. A lista de quadros continua dizendo 10 de 10.
        const user = await factory.createUser();
        const board = await factory.createBoard(user, { autoArchiveDoneAfterDays: 7 });
        const done = await factory.createList(board, { isDone: true });

        for (let i = 0; i < 10; i++) {
            await factory.createCard(done, { completedAt: new Date('2026-01-01T12:00:00Z'), archivedAt: new Date() });
        }

        const { boards: summaries } = await loadBoardsIndex(user);

        expect(summaries[0]).toMatchObject({ cards_count: 10, done_count: 10 });
    });
});

describe('criar quadro', () => {
    it('semeia listas e etiquetas e põe o criador como dono', async () => {
        const user = await factory.createUser();

        const board = await createBoard(user, { title: 'Novo quadro', background: 'ocean' });

        expect(board).toMatchObject({ title: 'Novo quadro', background: 'ocean', ownerId: user.id });
        expect(await db.$count(boardLists, eq(boardLists.boardId, board.id))).toBe(3);
        expect(await db.$count(labels, eq(labels.boardId, board.id))).toBe(4);
        expect((await membership(board, user))?.role).toBe('owner');
    });

    it('cria as etiquetas e as colunas na ordem certa, com o último acesso marcado', async () => {
        freeze('2026-10-12T12:00:00Z');

        const user = await factory.createUser();
        const board = await createBoard(user, { title: 'Ordem', background: 'aurora' });

        const labelRows = await db
            .select({ name: labels.name, color: labels.color })
            .from(labels)
            .where(eq(labels.boardId, board.id))
            .orderBy(asc(labels.id));

        expect(labelRows).toEqual([
            { name: 'Verde', color: 'emerald' },
            { name: 'Urgente', color: 'rose' },
            { name: 'Ideia', color: 'violet' },
            { name: 'Bloqueado', color: 'amber' },
        ]);

        const listRows = await db
            .select({ title: boardLists.title, position: boardLists.position, isDone: boardLists.isDone })
            .from(boardLists)
            .where(eq(boardLists.boardId, board.id))
            .orderBy(asc(boardLists.position));

        expect(listRows).toEqual([
            { title: 'A fazer', position: 1, isDone: false },
            { title: 'Em andamento', position: 2, isDone: false },
            { title: 'Concluído', position: 3, isDone: true },
        ]);

        expect((await membership(board, user))?.lastOpenedAt?.toISOString()).toBe('2026-10-12T12:00:00.000Z');
    });

    it('ganha uma coluna de conclusão', async () => {
        const user = await factory.createUser();
        const board = await createBoard(user, { title: 'Novo', background: 'ocean' });

        const doneLists = await db
            .select({ title: boardLists.title })
            .from(boardLists)
            .where(and(eq(boardLists.boardId, board.id), eq(boardLists.isDone, true)));

        expect(doneLists.map((list) => list.title)).toEqual(['Concluído']);
    });

    it('registra a criação no histórico em nome de quem criou', async () => {
        const user = await factory.createUser();
        const board = await createBoard(user, { title: 'Com histórico', background: 'aurora' });

        const [entry] = await activitiesOf(board, 'board.created');

        expect(entry).toMatchObject({ userId: user.id, description: 'criou o quadro Com histórico', properties: null });
    });
});

describe('abrir o quadro', () => {
    it('não deixa quem não é membro abrir', async () => {
        const board = await factory.createBoard(await factory.createUser());
        const stranger = await factory.createUser();

        await expectHttpError(loadBoardPage(stranger, board.id), 403);
    });

    it('dá 404 para quadro inexistente ou id impossível', async () => {
        const user = await factory.createUser();

        await expectHttpError(loadBoardPage(user, 999_999), 404);
        await expectHttpError(loadBoardPage(user, Number.NaN), 404);
        await expectHttpError(loadBoardPage(user, 1.5), 404);
        await expectHttpError(loadBoardPage(user, 99_999_999_999), 404);
    });

    it('deixa os membros abrirem', async () => {
        const board = await factory.createBoard(await factory.createUser());
        const member = await factory.createUser();
        await factory.addMember(board, member, 'member');

        const page = await loadBoardPage(member, board.id);

        expect(page.board.id).toBe(board.id);
        expect(page.board.role).toBe('member');
        expect(page.board.can).toEqual({ manage: false, delete: false });
    });

    it('monta o payload completo: colunas vivas em ordem, cards, etiquetas, membros e configurações', async () => {
        const owner = await factory.createUser({ name: 'Dona do Quadro' });
        const admin = await factory.createUser({ name: 'Admin' });
        const board = await factory.createBoard(owner, {
            title: 'Kanban',
            description: 'Descrição',
            background: 'forest',
            autoArchiveDoneAfterDays: 14,
        });
        await factory.addMember(board, admin, 'admin');

        const second = await factory.createList(board, { title: 'Segunda', position: 2, cardLimit: 5 });
        const first = await factory.createList(board, { title: 'Primeira', position: 1 });
        await factory.createList(board, { title: 'Arquivada', position: 0.5, archivedAt: new Date() });
        const done = await factory.createList(board, { title: 'Pronto', position: 3, isDone: true });

        const urgent = await factory.createLabel(board, { name: 'Urgente', color: 'rose' });
        const idea = await factory.createLabel(board, { name: null, color: 'violet' });

        const later = await factory.createCard(first, { title: 'Depois', position: 2, description: '   ' });
        const sooner = await factory.createCard(first, {
            title: 'Antes',
            position: 1,
            description: 'Com texto',
            coverColor: 'amber',
            dueAt: new Date('2026-10-12T17:30:00Z'),
        });
        await factory.createCard(first, { title: 'Arquivado', position: 0, archivedAt: new Date() });
        const finished = await factory.createCard(done, { completedAt: new Date('2026-10-10T12:00:00Z') });

        await factory.attachLabel(sooner, idea);
        await factory.attachLabel(sooner, urgent);
        await factory.assign(sooner, admin);

        const page = await loadBoardPage(owner, board.id);

        expect(page.backgrounds).toEqual(['aurora', 'sunset', 'ocean', 'forest', 'candy', 'midnight', 'ember', 'graphite']);
        expect(page.colors).toEqual(['emerald', 'amber', 'orange', 'rose', 'violet', 'blue', 'sky', 'lime', 'pink', 'slate']);
        expect(page.autoArchive).toEqual({ at: '03:00', options: [1, 3, 7, 14, 30] });

        expect(page.board).toMatchObject({
            id: board.id,
            title: 'Kanban',
            description: 'Descrição',
            background: 'forest',
            owner_id: owner.id,
            is_favorite: false,
            role: 'owner',
            can: { manage: true, delete: true },
            auto_archive_days: 14,
            archived_count: 1,
        });

        expect(page.board.members.map((member) => [member.id, member.role])).toEqual([
            [owner.id, 'owner'],
            [admin.id, 'admin'],
        ]);
        expect(page.board.labels).toEqual([
            { id: urgent.id, name: 'Urgente', color: 'rose' },
            { id: idea.id, name: null, color: 'violet' },
        ]);

        expect(page.board.lists.map((list) => list.id)).toEqual([first.id, second.id, done.id]);
        expect(page.board.lists[1]).toEqual({
            id: second.id,
            title: 'Segunda',
            position: 2,
            card_limit: 5,
            is_done: false,
            cards: [],
        });
        expect(page.board.lists[2]).toMatchObject({ is_done: true });

        const [firstCard, secondCard] = page.board.lists[0]!.cards;

        expect(page.board.lists[0]!.cards).toHaveLength(2);
        expect(firstCard).toEqual({
            id: sooner.id,
            board_list_id: first.id,
            title: 'Antes',
            position: 1,
            cover_color: 'amber',
            due_at: '2026-10-12T14:30:00-03:00',
            completed_at: null,
            has_description: true,
            label_ids: [idea.id, urgent.id],
            member_ids: [admin.id],
            comments_count: 0,
            checklist_total: 0,
            checklist_done: 0,
        });
        expect(secondCard).toMatchObject({ id: later.id, has_description: false, label_ids: [], member_ids: [] });
        expect(page.board.lists[2]!.cards[0]).toMatchObject({
            id: finished.id,
            completed_at: '2026-10-10T09:00:00-03:00',
        });
    });

    it('carrega os contadores de checklist e de comentários de cada card', async () => {
        const owner = await factory.createUser();
        const board = await factory.createBoard(owner);
        const todo = await factory.createList(board, { position: 1 });
        await factory.createList(board, { position: 2 });
        const card = await factory.createCard(todo, { position: 1 });
        const quiet = await factory.createCard(todo, { position: 2 });

        const [steps, extra] = await db
            .insert(checklists)
            .values([
                { cardId: card.id, title: 'Passos', position: 1 },
                { cardId: card.id, title: 'Extra', position: 2 },
            ])
            .returning();

        await db.insert(checklistItems).values([
            { checklistId: steps!.id, content: 'a', isDone: true, position: 1 },
            { checklistId: steps!.id, content: 'b', isDone: false, position: 2 },
            { checklistId: extra!.id, content: 'c', isDone: true, position: 1 },
        ]);
        await db.insert(comments).values([
            { cardId: card.id, userId: owner.id, body: 'oi' },
            { cardId: card.id, userId: owner.id, body: 'tudo bem?' },
        ]);

        const { board: payload } = await loadBoardPage(owner, board.id);

        expect(payload.lists[0]!.cards[0]).toMatchObject({ id: card.id, checklist_total: 3, checklist_done: 2, comments_count: 2 });
        expect(payload.lists[0]!.cards[1]).toMatchObject({ id: quiet.id, checklist_total: 0, checklist_done: 0, comments_count: 0 });
    });

    it('tira do payload o card arquivado, mas conta a gaveta', async () => {
        const owner = await factory.createUser();
        const board = await factory.createBoard(owner, { autoArchiveDoneAfterDays: 7 });
        const todo = await factory.createList(board, { title: 'A fazer', position: 1 });
        const done = await factory.createList(board, { title: 'Concluído', position: 2, isDone: true });

        // O que a varredura da madrugada deixa para trás.
        await factory.createCard(done, { completedAt: new Date(Date.now() - 10 * 86_400_000), archivedAt: new Date() });
        await factory.createCard(todo);

        const { board: payload } = await loadBoardPage(owner, board.id);

        expect(payload.lists[0]!.cards).toHaveLength(1);
        expect(payload.lists[1]!.cards).toHaveLength(0);
        expect(payload.archived_count).toBe(1);
        expect(payload.auto_archive_days).toBe(7);
    });

    it('marca o último acesso de quem abriu e lê o favorito dessa pessoa', async () => {
        const owner = await factory.createUser();
        const member = await factory.createUser();
        const board = await factory.createBoard(owner);
        await factory.addMember(board, member);
        await db
            .update(boardUser)
            .set({ isFavorite: true })
            .where(and(eq(boardUser.boardId, board.id), eq(boardUser.userId, member.id)));
        const ownerOpenedAt = (await membership(board, owner))?.lastOpenedAt;

        freeze('2026-10-12T15:00:00Z');

        const page = await loadBoardPage(member, board.id);

        expect(page.board.is_favorite).toBe(true);
        expect((await membership(board, member))?.lastOpenedAt?.toISOString()).toBe('2026-10-12T15:00:00.000Z');
        expect((await membership(board, owner))?.lastOpenedAt).toEqual(ownerOpenedAt);
    });
});

describe('histórico e título do quadro', () => {
    it('traz os 60 eventos mais recentes, com quem fez', async () => {
        const owner = await factory.createUser({ name: 'Quem Fez' });
        const board = await factory.createBoard(owner);
        const base = Date.parse('2026-10-01T12:00:00Z');

        await db.insert(activities).values(
            Array.from({ length: 65 }, (_, i) => ({
                boardId: board.id,
                userId: owner.id,
                type: 'card.created',
                description: `evento ${i}`,
                createdAt: new Date(base + i * 60_000),
            })),
        );

        const feed = await loadBoardActivity(owner, board.id);

        expect(feed).toHaveLength(60);
        expect(feed[0]).toMatchObject({
            description: 'evento 64',
            created_at: '2026-10-01T10:04:00-03:00',
            user: { id: owner.id, name: 'Quem Fez', initials: 'QF' },
        });
        expect(feed[59]!.description).toBe('evento 5');
        expect(feed[0]).not.toHaveProperty('board');
        expect(feed[0]!.user).not.toHaveProperty('role');
    });

    it('desempata pelo id e aceita evento sem autor', async () => {
        const owner = await factory.createUser();
        const board = await factory.createBoard(owner);
        const at = new Date('2026-10-01T12:00:00Z');

        await db.insert(activities).values([
            { boardId: board.id, userId: owner.id, type: 'a', description: 'primeiro', createdAt: at },
            { boardId: board.id, userId: null, type: 'cards.auto_archived', description: 'segundo', createdAt: at },
        ]);

        const feed = await loadBoardActivity(owner, board.id);

        expect(feed.map((entry) => entry.description)).toEqual(['segundo', 'primeiro']);
        expect(feed[0]!.user).toBeNull();
    });

    it('não mostra o histórico a quem não é membro', async () => {
        const board = await factory.createBoard(await factory.createUser());

        await expectHttpError(loadBoardActivity(await factory.createUser(), board.id), 403);
    });

    it('dá o título só a quem pode ver o quadro', async () => {
        const owner = await factory.createUser();
        const board = await factory.createBoard(owner, { title: 'Segredo' });
        const stranger = await factory.createUser();

        expect(await loadBoardTitle(owner, board.id)).toBe('Segredo');
        expect(await loadBoardTitle(stranger, board.id)).toBeNull();
        expect(await loadBoardTitle(owner, 999_999)).toBeNull();
        expect(await loadBoardTitle(owner, Number.NaN)).toBeNull();
    });
});

describe('configurações do quadro', () => {
    it('não deixam membro comum mudar nada', async () => {
        const board = await factory.createBoard(await factory.createUser(), { background: 'aurora' });
        const member = await factory.createUser();
        await factory.addMember(board, member, 'member');

        await expectHttpError(updateBoard(member, board.id, { background: 'ember' }), 403);

        expect((await boardRow(board))?.background).toBe('aurora');
    });

    it('mudam só os campos enviados', async () => {
        const owner = await factory.createUser();
        const admin = await factory.createUser();
        const board = await factory.createBoard(owner, { title: 'Antes', description: 'Texto', background: 'aurora' });
        await factory.addMember(board, admin, 'admin');

        await updateBoard(admin, board.id, { title: 'Depois' });

        expect(await boardRow(board)).toMatchObject({ title: 'Depois', description: 'Texto', background: 'aurora' });

        await updateBoard(owner, board.id, { description: null, background: 'candy' });

        expect(await boardRow(board)).toMatchObject({ title: 'Depois', description: null, background: 'candy' });
        expect(await activitiesOf(board, 'board.auto_archive')).toHaveLength(0);
    });

    it('o prazo só aceita as opções configuradas', async () => {
        const owner = await factory.createUser();
        const board = await factory.createBoard(owner, { autoArchiveDoneAfterDays: 7 });

        await expectHttpError(updateBoard(owner, board.id, { auto_archive_done_after_days: 5 }), 422, 'auto_archive_done_after_days');

        expect((await boardRow(board))?.autoArchiveDoneAfterDays).toBe(7);
    });

    it('null desliga o prazo e o histórico registra', async () => {
        const owner = await factory.createUser();
        const board = await factory.createBoard(owner, { autoArchiveDoneAfterDays: 7 });

        await updateBoard(owner, board.id, { auto_archive_done_after_days: null });

        expect((await boardRow(board))?.autoArchiveDoneAfterDays).toBeNull();

        const entries = await activitiesOf(board, 'board.auto_archive');

        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({
            userId: owner.id,
            description: 'desligou o arquivamento automático dos concluídos',
            properties: { after_days: null },
        });
    });

    it('ligar ou trocar o prazo também fica no histórico, no singular e no plural', async () => {
        const owner = await factory.createUser();
        const board = await factory.createBoard(owner);

        await updateBoard(owner, board.id, { auto_archive_done_after_days: 7 });
        await updateBoard(owner, board.id, { auto_archive_done_after_days: 1 });

        const entries = await activitiesOf(board, 'board.auto_archive');

        expect(entries.map((entry) => [entry.description, entry.properties])).toEqual([
            ['passou a arquivar os concluídos depois de 7 dias', { after_days: 7 }],
            ['passou a arquivar os concluídos depois de 1 dia', { after_days: 1 }],
        ]);
    });

    it('reenviar o mesmo prazo não registra troca', async () => {
        const owner = await factory.createUser();
        const board = await factory.createBoard(owner, { autoArchiveDoneAfterDays: 7 });

        await updateBoard(owner, board.id, { auto_archive_done_after_days: 7, title: 'Outro título' });

        expect(await activitiesOf(board, 'board.auto_archive')).toHaveLength(0);
        expect((await boardRow(board))?.title).toBe('Outro título');
    });

    it('membro comum não muda o prazo', async () => {
        const owner = await factory.createUser();
        const board = await factory.createBoard(owner, { autoArchiveDoneAfterDays: 7 });
        const member = await factory.createUser();
        await factory.addMember(board, member, 'member');

        await expectHttpError(updateBoard(member, board.id, { auto_archive_done_after_days: 30 }), 403);

        expect((await boardRow(board))?.autoArchiveDoneAfterDays).toBe(7);
    });
});

describe('excluir e favoritar', () => {
    it('só o dono exclui o quadro, e tudo vai junto', async () => {
        const owner = await factory.createUser();
        const board = await factory.createBoard(owner);
        const admin = await factory.createUser();
        await factory.addMember(board, admin, 'admin');
        const list = await factory.createList(board);
        await factory.createCard(list);

        await expectHttpError(deleteBoard(admin, board.id), 403);
        expect(await boardRow(board)).toBeDefined();

        await deleteBoard(owner, board.id);

        expect(await boardRow(board)).toBeUndefined();
        expect(await db.$count(boardUser, eq(boardUser.boardId, board.id))).toBe(0);
        expect(await db.$count(boardLists, eq(boardLists.boardId, board.id))).toBe(0);
    });

    it('excluir quadro inexistente é 404', async () => {
        await expectHttpError(deleteBoard(await factory.createUser(), 999_999), 404);
    });

    it('o favorito alterna por pessoa', async () => {
        const owner = await factory.createUser();
        const member = await factory.createUser();
        const board = await factory.createBoard(owner);
        await factory.addMember(board, member);

        expect(await toggleFavorite(owner, board.id)).toBe(true);
        expect((await membership(board, owner))?.isFavorite).toBe(true);
        expect((await membership(board, member))?.isFavorite).toBe(false);

        expect(await toggleFavorite(owner, board.id)).toBe(false);
        expect((await membership(board, owner))?.isFavorite).toBe(false);
    });

    it('quem não é membro não favorita', async () => {
        const board = await factory.createBoard(await factory.createUser());

        await expectHttpError(toggleFavorite(await factory.createUser(), board.id), 403);
    });
});

describe('membros', () => {
    it('convida uma conta existente pelo e-mail, com o papel escolhido', async () => {
        const owner = await factory.createUser();
        const board = await factory.createBoard(owner);
        const guest = await factory.createUser({ name: 'Carla Convidada', email: 'carla@taskon.test' });

        const added = await addBoardMember(owner, board.id, { email: 'Carla@Taskon.test', role: 'admin' });

        expect(added).toEqual({ kind: 'added', member: { id: guest.id, name: 'Carla Convidada' } });
        expect((await membership(board, guest))?.role).toBe('admin');

        const [entry] = await activitiesOf(board, 'member.added');

        expect(entry).toMatchObject({ userId: owner.id, description: 'adicionou Carla Convidada ao quadro' });
    });

    it('e-mail sem conta vira convite por e-mail (ver tests/invitations.test.ts)', async () => {
        const owner = await factory.createUser();
        const board = await factory.createBoard(owner);

        const result = await addBoardMember(owner, board.id, { email: 'Ninguem@Taskon.test', role: 'member' });

        expect(result).toEqual({ kind: 'invited', email: 'ninguem@taskon.test' });
        expect(await activitiesOf(board, 'member.added')).toHaveLength(0);
    });

    it('recusa quem já participa, no campo email', async () => {
        const owner = await factory.createUser();
        const board = await factory.createBoard(owner);
        const member = await factory.createUser();
        await factory.addMember(board, member);

        const already = await expectHttpError(addBoardMember(owner, board.id, { email: member.email, role: 'admin' }), 422, 'email');
        expect(already.errors?.email).toBe('Essa pessoa já participa do quadro.');

        // O papel de quem já estava não muda, e nada vai para o histórico.
        expect((await membership(board, member))?.role).toBe('member');
        expect(await activitiesOf(board, 'member.added')).toHaveLength(0);
    });

    it('membro comum não convida nem remove', async () => {
        const owner = await factory.createUser();
        const board = await factory.createBoard(owner);
        const member = await factory.createUser();
        const other = await factory.createUser();
        await factory.addMember(board, member);
        await factory.addMember(board, other);

        await expectHttpError(addBoardMember(member, board.id, { email: (await factory.createUser()).email, role: 'member' }), 403);
        await expectHttpError(removeBoardMember(member, board.id, other.id), 403);
    });

    it('remove a pessoa, registra no histórico e mantém as atribuições dela nos cards', async () => {
        const owner = await factory.createUser();
        const board = await factory.createBoard(owner);
        const leaving = await factory.createUser({ name: 'Davi Saindo' });
        await factory.addMember(board, leaving);
        const card = await factory.createCard(await factory.createList(board));
        await factory.assign(card, leaving);

        await removeBoardMember(owner, board.id, leaving.id);

        expect(await membership(board, leaving)).toBeUndefined();
        expect(await db.$count(cardUser, eq(cardUser.userId, leaving.id))).toBe(1);

        const entries = await activitiesOf(board, 'member.removed');

        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ userId: owner.id, description: 'removeu Davi Saindo do quadro' });

        // Segundo clique (outra aba): nada muda e o histórico não repete.
        await removeBoardMember(owner, board.id, leaving.id);

        expect(await activitiesOf(board, 'member.removed')).toHaveLength(1);
    });

    it('o dono não pode ser removido — o aviso vai para o toast, não para um campo', async () => {
        const owner = await factory.createUser();
        const board = await factory.createBoard(owner);
        const admin = await factory.createUser();
        await factory.addMember(board, admin, 'admin');

        const error = await expectHttpError(removeBoardMember(admin, board.id, owner.id), 422);

        expect(error.message).toBe('O dono do quadro não pode ser removido.');
        expect(error.errors).toBeUndefined();
        expect((await membership(board, owner))?.role).toBe('owner');
    });

    it('remover conta inexistente é 404', async () => {
        const owner = await factory.createUser();
        const board = await factory.createBoard(owner);

        await expectHttpError(removeBoardMember(owner, board.id, 999_999), 404);
    });
});
