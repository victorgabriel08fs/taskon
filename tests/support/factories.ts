import { eq, max } from 'drizzle-orm';
import { hashPassword } from '@/server/auth/password';
import { db } from '@/server/db';
import {
    boardLists,
    boardUser,
    boards,
    cardLabel,
    cardUser,
    cards,
    labels,
    users,
    type BoardListRow,
    type BoardRow,
    type CardRow,
    type LabelRow,
    type UserRow,
} from '@/server/db/schema';
import type { BoardRole } from '@/types';

/**
 * As factories do Laravel (UserFactory, BoardFactory…): inserem direto no
 * banco, sem passar pelos serviços, para o teste montar exatamente o cenário
 * que quer — inclusive os que a interface não deixaria criar.
 */

let sequence = 0;
const next = () => ++sequence;

let passwordHash: Promise<string> | null = null;

/** Senha de todo usuário de teste: "password". */
export async function createUser(overrides: Partial<typeof users.$inferInsert> = {}): Promise<UserRow> {
    passwordHash ??= hashPassword('password');
    const n = next();

    const [user] = await db
        .insert(users)
        .values({
            name: `Pessoa ${n}`,
            email: `pessoa${n}@taskon.test`,
            password: await passwordHash,
            avatarColor: 'violet',
            ...overrides,
        })
        .returning();

    return user!;
}

/** Quadro com o dono já como membro `owner` (como no BoardController@store). */
export async function createBoard(owner: UserRow, overrides: Partial<typeof boards.$inferInsert> = {}): Promise<BoardRow> {
    const [board] = await db
        .insert(boards)
        .values({ ownerId: owner.id, title: `Quadro ${next()}`, background: 'aurora', ...overrides })
        .returning();

    await db.insert(boardUser).values({ boardId: board!.id, userId: owner.id, role: 'owner', lastOpenedAt: new Date() });

    return board!;
}

export async function addMember(board: BoardRow, user: UserRow, role: BoardRole = 'member'): Promise<void> {
    await db.insert(boardUser).values({ boardId: board.id, userId: user.id, role });
}

/** Lista no fim do quadro. */
export async function createList(board: BoardRow, overrides: Partial<typeof boardLists.$inferInsert> = {}): Promise<BoardListRow> {
    const [last] = await db
        .select({ position: max(boardLists.position) })
        .from(boardLists)
        .where(eq(boardLists.boardId, board.id));

    const [list] = await db
        .insert(boardLists)
        .values({ boardId: board.id, title: `Lista ${next()}`, position: (last?.position ?? 0) + 1, ...overrides })
        .returning();

    return list!;
}

/** Card no fim da lista; `board_id` vem da lista. */
export async function createCard(list: BoardListRow, overrides: Partial<typeof cards.$inferInsert> = {}): Promise<CardRow> {
    const [last] = await db
        .select({ position: max(cards.position) })
        .from(cards)
        .where(eq(cards.boardListId, list.id));

    const [card] = await db
        .insert(cards)
        .values({
            boardId: list.boardId,
            boardListId: list.id,
            title: `Card ${next()}`,
            position: (last?.position ?? 0) + 1,
            ...overrides,
        })
        .returning();

    return card!;
}

export async function assign(card: CardRow, user: UserRow): Promise<void> {
    await db.insert(cardUser).values({ cardId: card.id, userId: user.id });
}

export async function createLabel(board: BoardRow, overrides: Partial<typeof labels.$inferInsert> = {}): Promise<LabelRow> {
    const [label] = await db
        .insert(labels)
        .values({ boardId: board.id, name: `Etiqueta ${next()}`, color: 'emerald', ...overrides })
        .returning();

    return label!;
}

export async function attachLabel(card: CardRow, label: LabelRow): Promise<void> {
    await db.insert(cardLabel).values({ cardId: card.id, labelId: label.id });
}

/** Lê o card de novo do banco (o `->fresh()` do Eloquent). */
export async function fresh(card: Pick<CardRow, 'id'>): Promise<CardRow | undefined> {
    const [row] = await db.select().from(cards).where(eq(cards.id, card.id));

    return row;
}
