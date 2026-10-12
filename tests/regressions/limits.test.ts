import { asc, count, eq, sql } from 'drizzle-orm';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { parseRouteId } from '@/lib/route-id';
import { moveCard } from '@/server/actions/cards';
import { reorderLists } from '@/server/actions/lists';
import { db } from '@/server/db';
import { boardLists, cards, type BoardListRow, type UserRow } from '@/server/db/schema';
import { createBoard, createCard, createList, createUser, fresh } from '../support/factories';

/**
 * Regressões de limites do banco:
 *
 *  - toda chave estrangeira tem índice (o InnoDB criava um para cada FK; o
 *    Postgres não, e apagar um usuário ou uma etiqueta varria a tabela);
 *  - `ordered_ids` tem teto, e uma reordenação é UM comando UPDATE, por mais
 *    ids (repetidos, até) que o pedido traga;
 *  - id de rota acima do teto do `integer` é 404, não um erro de banco (500).
 */
const request = vi.hoisted(() => ({ user: null as UserRow | null }));

vi.mock('@/server/auth/session', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/server/auth/session')>()),
    currentSession: async () => (request.user ? { user: request.user, session: { id: 'sessao-de-teste' } } : null),
    currentUser: async () => request.user,
    requireUser: async () => {
        if (!request.user) throw Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/login;307;' });

        return request.user;
    },
}));
vi.mock('next/cache', () => ({ refresh: vi.fn() }));

/** As linhas de um `db.execute` (o `pg` e o PGlite devolvem formatos diferentes). */
function rowsOf<T>(result: unknown): T[] {
    return (Array.isArray(result) ? result : (result as { rows: T[] }).rows) as T[];
}

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

/**
 * Um gatilho FOR EACH STATEMENT anota cada COMANDO UPDATE que chega à tabela
 * (não cada linha): é como provar "um UPDATE só" sem medir tempo. A tabela de
 * anotações é zerada com as outras antes de cada teste (tests/setup.ts).
 */
const updateStatements = pgTable('update_statements', { tableName: text('table_name').notNull() });

beforeAll(async () => {
    await db.execute(sql`create table update_statements (table_name text not null)`);
    await db.execute(
        sql.raw(`
            create function log_update_statement() returns trigger language plpgsql as $$
            begin
                insert into update_statements (table_name) values (tg_table_name);

                return null;
            end;
            $$
        `),
    );

    for (const table of ['board_lists', 'cards']) {
        await db.execute(
            sql.raw(
                `create trigger ${table}_update_statements after update on ${table} for each statement execute function log_update_statement()`,
            ),
        );
    }
});

/** Roda `call` e devolve o resultado e quantos comandos UPDATE a tabela recebeu nele. */
async function countingUpdates<T>(table: 'board_lists' | 'cards', call: () => Promise<T>): Promise<{ result: T; updates: number }> {
    await db.delete(updateStatements);

    const result = await call();
    const [row] = await db.select({ total: count() }).from(updateStatements).where(eq(updateStatements.tableName, table));

    return { result, updates: row?.total ?? 0 };
}

async function cardIdsIn(list: BoardListRow): Promise<number[]> {
    const rows = await db
        .select({ id: cards.id })
        .from(cards)
        .where(eq(cards.boardListId, list.id))
        .orderBy(asc(cards.position), asc(cards.id));

    return rows.map((row) => row.id);
}

async function listPosition(list: Pick<BoardListRow, 'id'>): Promise<number | undefined> {
    const [row] = await db.select({ position: boardLists.position }).from(boardLists).where(eq(boardLists.id, list.id));

    return row?.position;
}

/** `n` cópias do mesmo id — o pedido forjado barato de montar e caro de gravar. */
const repeated = (id: number, n: number) => Array.from({ length: n }, () => id);

describe('índices das chaves estrangeiras', () => {
    it('toda FK tem um índice que começa pelas colunas dela', async () => {
        // A coluna da FK tem de ser o PREFIXO de algum índice: é o que o
        // Postgres usa para achar as linhas filhas num ON DELETE CASCADE/SET
        // NULL, em vez de varrer a tabela inteira.
        const unindexed = rowsOf<{ fk: string }>(
            await db.execute(sql`
                select c.conrelid::regclass::text || '.' || c.conname as fk
                from pg_constraint c
                where c.contype = 'f'
                  and not exists (
                      select 1
                      from pg_index i
                      where i.indrelid = c.conrelid
                        and (string_to_array(i.indkey::text, ' ')::int2[])[1:array_length(c.conkey, 1)] = c.conkey
                  )
                order by 1
            `),
        );

        expect(unindexed.map((row) => row.fk)).toEqual([]);

        const created = rowsOf<{ name: string }>(
            await db.execute(sql`
                select indexname as name
                from pg_indexes
                where schemaname = 'public'
                  and indexname in ('card_label_label_id_index', 'comments_user_id_index', 'activities_user_id_index', 'cards_created_by_index')
                order by 1
            `),
        );

        expect(created.map((row) => row.name)).toEqual([
            'activities_user_id_index',
            'card_label_label_id_index',
            'cards_created_by_index',
            'comments_user_id_index',
        ]);
    });
});

describe('ordered_ids: teto e um UPDATE só', () => {
    it('reordenar colunas com mais de 1000 ids é 422, sem tocar no banco', async () => {
        const owner = await createUser();
        const board = await createBoard(owner);
        const list = await createList(board, { position: 1 });

        request.user = owner;

        const { result, updates } = await countingUpdates('board_lists', () =>
            reorderLists({ boardId: board.id, ordered_ids: repeated(list.id, 1001) }),
        );

        expect(result).toMatchObject({
            ok: false,
            status: 422,
            errors: { ordered_ids: 'Este quadro tem colunas demais para reordenar (máximo de 1000).' },
        });
        expect(updates).toBe(0);
        expect(await listPosition(list)).toBe(1);
    });

    it('reordenar colunas com 1000 ids repetidos é um UPDATE só, e vale a última aparição de cada id', async () => {
        const owner = await createUser();
        const board = await createBoard(owner);
        const a = await createList(board, { position: 1 });
        const b = await createList(board, { position: 2 });
        const foreign = await createList(await createBoard(await createUser()), { position: 5 });

        request.user = owner;

        // 997 × a, depois foreign, b e a: a última aparição de `a` é a 1000ª.
        const ordered = [...repeated(a.id, 997), foreign.id, b.id, a.id];

        const { result, updates } = await countingUpdates('board_lists', () =>
            reorderLists({ boardId: board.id, ordered_ids: ordered }),
        );

        expect(result).toEqual({ ok: true, data: null });
        expect(updates).toBe(1);
        expect(await listPosition(b)).toBe(999);
        expect(await listPosition(a)).toBe(1000);

        // A lista de outro quadro nem entra no comando.
        expect(await listPosition(foreign)).toBe(5);
    });

    it('mover card com mais de 1000 ids é 422, e o card fica onde estava', async () => {
        const owner = await createUser();
        const board = await createBoard(owner);
        const todo = await createList(board, { position: 1 });
        const doing = await createList(board, { position: 2 });
        const card = await createCard(todo, { position: 1 });

        request.user = owner;

        const { result, updates } = await countingUpdates('cards', () =>
            moveCard({ cardId: card.id, board_list_id: doing.id, ordered_ids: repeated(card.id, 1001) }),
        );

        expect(result).toMatchObject({
            ok: false,
            status: 422,
            errors: { ordered_ids: 'Esta coluna tem cards demais para reordenar (máximo de 1000).' },
        });
        expect(updates).toBe(0);
        expect(await fresh(card)).toMatchObject({ boardListId: todo.id, position: 1 });
    });

    it('mover card com 1000 ids repetidos são dois UPDATEs (o card e as posições), e vale a última aparição', async () => {
        const owner = await createUser();
        const board = await createBoard(owner);
        const todo = await createList(board, { position: 1 });
        const doing = await createList(board, { position: 2 });
        const first = await createCard(doing, { position: 1 });
        const second = await createCard(doing, { position: 2 });
        const moved = await createCard(todo, { position: 1 });

        request.user = owner;

        // `first` aparece 998 vezes, mas a última aparição é depois dos outros dois.
        const ordered = [...repeated(first.id, 997), moved.id, second.id, first.id];

        const { result, updates } = await countingUpdates('cards', () =>
            moveCard({ cardId: moved.id, board_list_id: doing.id, ordered_ids: ordered }),
        );

        expect(result).toEqual({ ok: true, data: null });
        expect(updates).toBe(2);
        expect(await cardIdsIn(doing)).toEqual([moved.id, second.id, first.id]);
        expect((await fresh(first))?.position).toBe(1000);
    });
});

describe('ids de rota', () => {
    it('só inteiros positivos que cabem num integer do Postgres', () => {
        expect(parseRouteId('1')).toBe(1);
        expect(parseRouteId('42')).toBe(42);
        expect(parseRouteId('2147483647')).toBe(2_147_483_647);

        for (const value of ['2147483648', '3000000000', '99999999999999999999', '0', '', 'abc', '1.5', '0x10', '1e3', '-1', '+7', ' 7', '7 ']) {
            expect(parseRouteId(value), JSON.stringify(value)).toBeNull();
        }
    });

    it('deep link de card com id acima do teto é 404, não 500', async () => {
        const { default: CardPage } = await import('@/app/(app)/boards/[boardId]/cards/[cardId]/page');
        const owner = await createUser();
        const board = await createBoard(owner);
        const card = await createCard(await createList(board));

        request.user = owner;

        const open = (boardId: string, cardId: string) => digestOf(CardPage({ params: Promise.resolve({ boardId, cardId }) }));

        expect(await open(String(board.id), '3000000000')).toMatch(/^NEXT_HTTP_ERROR_FALLBACK;404/);
        expect(await open('3000000000', String(card.id))).toMatch(/^NEXT_HTTP_ERROR_FALLBACK;404/);
        expect(await open(String(board.id), '2147483648')).toMatch(/^NEXT_HTTP_ERROR_FALLBACK;404/);
    });

    it('quadro com id acima do teto é 404, e a aba fica com o título padrão', async () => {
        const { default: BoardLayout, generateMetadata } = await import('@/app/(app)/boards/[boardId]/layout');

        request.user = await createUser();

        const params = Promise.resolve({ boardId: '3000000000' });

        expect(await digestOf(BoardLayout({ params, children: null }))).toMatch(/^NEXT_HTTP_ERROR_FALLBACK;404/);
        expect(await generateMetadata({ params })).toEqual({});
    });
});
