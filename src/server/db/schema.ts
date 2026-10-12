/**
 * O banco, em Drizzle. Espelha as migrations do Laravel tabela a tabela —
 * mesmos nomes, mesmas colunas (snake_case no banco, camelCase no TypeScript)
 * — trocando MySQL por Postgres. Saíram só as tabelas de infraestrutura do
 * framework (cache, jobs, failed_jobs); `sessions` e `password_reset_tokens`
 * foram redesenhadas para guardar só o hash dos tokens.
 *
 * Toda data é `timestamptz`: o instante é guardado sem ambiguidade e o fuso do
 * app (`APP_TIMEZONE`) só entra na hora de decidir "hoje" ou formatar.
 *
 * Toda chave estrangeira começa algum índice. O InnoDB criava um sozinho para
 * cada FK; o Postgres não, e sem ele apagar o registro pai (o ON DELETE
 * CASCADE / SET NULL) varre a tabela filha inteira atrás de quem aponta para
 * ele. Quando um índice composto já começa pela coluna, ele basta.
 */
import { relations } from 'drizzle-orm';
import {
    boolean,
    doublePrecision,
    index,
    integer,
    jsonb,
    pgTable,
    smallint,
    text,
    timestamp,
    uniqueIndex,
    varchar,
} from 'drizzle-orm/pg-core';

const id = () => integer('id').primaryKey().generatedByDefaultAsIdentity();

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * created_at/updated_at preenchidos pelo relógio da APLICAÇÃO (`new Date()`),
 * não pelo `now()` do banco: é o que o Eloquent fazia, e é o que permite aos
 * testes congelar o tempo (vi.setSystemTime) como o Carbon::setTestNow. O
 * DEFAULT now() continua no banco para inserts feitos fora do Drizzle.
 */
const timestamps = {
    createdAt: tz('created_at')
        .notNull()
        .defaultNow()
        .$defaultFn(() => new Date()),
    updatedAt: tz('updated_at')
        .notNull()
        .defaultNow()
        .$defaultFn(() => new Date())
        .$onUpdate(() => new Date()),
};

/* -------------------------------------------------------------------------- */
/* Contas                                                                      */
/* -------------------------------------------------------------------------- */

export const users = pgTable(
    'users',
    {
        id: id(),
        name: varchar('name', { length: 255 }).notNull(),

        // Sempre minúsculo: o MySQL comparava sem diferenciar caixa, o Postgres
        // não. A normalização acontece na entrada (cadastro, login, perfil).
        email: varchar('email', { length: 255 }).notNull(),
        avatarColor: varchar('avatar_color', { length: 20 }).notNull().default('violet'),
        title: varchar('title', { length: 255 }),

        // Opt-out, não opt-in: quem cria a conta já recebe o resumo.
        dailyDigest: boolean('daily_digest').notNull().default(true),

        // Carimbo do último envio BEM-SUCEDIDO — a trava contra o envio duplo.
        digestLastSentAt: tz('digest_last_sent_at'),
        emailVerifiedAt: tz('email_verified_at'),
        password: varchar('password', { length: 255 }).notNull(),
        ...timestamps,
    },
    (table) => [uniqueIndex('users_email_unique').on(table.email)],
);

/**
 * Uma linha por login. O cookie leva o token cru; aqui só fica o SHA-256 dele,
 * então um vazamento do banco não entrega sessões prontas.
 */
export const sessions = pgTable(
    'sessions',
    {
        id: varchar('id', { length: 64 }).primaryKey(),
        userId: integer('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        ipAddress: varchar('ip_address', { length: 45 }),
        userAgent: text('user_agent'),
        remember: boolean('remember').notNull().default(false),
        lastActivityAt: tz('last_activity_at').notNull().defaultNow(),
        expiresAt: tz('expires_at').notNull(),
        createdAt: tz('created_at').notNull().defaultNow(),
    },
    (table) => [index('sessions_user_id_index').on(table.userId), index('sessions_expires_at_index').on(table.expiresAt)],
);

/** Um pedido de redefinição por e-mail; o token também é guardado como hash. */
export const passwordResetTokens = pgTable('password_reset_tokens', {
    email: varchar('email', { length: 255 }).primaryKey(),
    token: varchar('token', { length: 64 }).notNull(),
    createdAt: tz('created_at').notNull().defaultNow(),
});

/**
 * O `RateLimiter` do Laravel morava no cache. Em serverless não há memória
 * compartilhada entre instâncias, então os contadores ficam no banco.
 */
export const rateLimits = pgTable('rate_limits', {
    key: varchar('key', { length: 255 }).primaryKey(),
    hits: integer('hits').notNull().default(0),
    resetAt: tz('reset_at').notNull(),
});

/* -------------------------------------------------------------------------- */
/* Quadros                                                                     */
/* -------------------------------------------------------------------------- */

export const boards = pgTable(
    'boards',
    {
        id: id(),
        ownerId: integer('owner_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        title: varchar('title', { length: 255 }).notNull(),
        description: text('description'),

        // Chave de um preset de gradiente (BACKGROUNDS em src/server/config.ts).
        background: varchar('background', { length: 40 }).notNull().default('aurora'),

        // Dias entre concluir o card e ele sair da coluna. null = desligado,
        // o estado de todo quadro novo: cards sumindo sozinhos precisam ser uma
        // decisão consciente.
        autoArchiveDoneAfterDays: smallint('auto_archive_done_after_days'),
        archivedAt: tz('archived_at'),
        ...timestamps,
    },
    (table) => [index('boards_owner_id_archived_at_index').on(table.ownerId, table.archivedAt)],
);

/** Pivô quadro ⇄ pessoa: papel, favorito e último acesso de cada membro. */
export const boardUser = pgTable(
    'board_user',
    {
        id: id(),
        boardId: integer('board_id')
            .notNull()
            .references(() => boards.id, { onDelete: 'cascade' }),
        userId: integer('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),

        // owner | admin | member
        role: varchar('role', { length: 20 }).notNull().default('member'),
        isFavorite: boolean('is_favorite').notNull().default(false),
        lastOpenedAt: tz('last_opened_at'),
        ...timestamps,
    },
    (table) => [
        uniqueIndex('board_user_board_id_user_id_unique').on(table.boardId, table.userId),
        index('board_user_user_id_is_favorite_index').on(table.userId, table.isFavorite),
    ],
);

export const boardLists = pgTable(
    'board_lists',
    {
        id: id(),
        boardId: integer('board_id')
            .notNull()
            .references(() => boards.id, { onDelete: 'cascade' }),
        title: varchar('title', { length: 255 }).notNull(),

        // Ordem da coluna no quadro. O cliente manda a ordem final inteira a cada
        // arraste e o servidor regrava todas as posições (índice + 1) num UPDATE só.
        position: doublePrecision('position').notNull().default(0),
        cardLimit: smallint('card_limit'),

        // Arrastar o card para esta coluna marca o card como concluído.
        isDone: boolean('is_done').notNull().default(false),
        archivedAt: tz('archived_at'),
        ...timestamps,
    },
    (table) => [index('board_lists_board_id_position_index').on(table.boardId, table.position)],
);

export const cards = pgTable(
    'cards',
    {
        id: id(),

        // board_id é desnormalizado de propósito: autorização e buscas por
        // quadro não precisam de join com board_lists.
        boardId: integer('board_id')
            .notNull()
            .references(() => boards.id, { onDelete: 'cascade' }),
        boardListId: integer('board_list_id')
            .notNull()
            .references(() => boardLists.id, { onDelete: 'cascade' }),
        createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
        title: varchar('title', { length: 500 }).notNull(),
        description: text('description'),
        position: doublePrecision('position').notNull().default(0),
        coverColor: varchar('cover_color', { length: 20 }),
        dueAt: tz('due_at'),
        completedAt: tz('completed_at'),
        archivedAt: tz('archived_at'),
        ...timestamps,
    },
    (table) => [
        index('cards_board_list_id_position_index').on(table.boardListId, table.position),
        index('cards_board_id_archived_at_index').on(table.boardId, table.archivedAt),

        // A varredura dos concluídos filtra por (board_id, archived_at, completed_at).
        index('cards_archive_sweep_index').on(table.boardId, table.archivedAt, table.completedAt),

        // Apagar uma conta anula o created_by dos cards dela (SET NULL).
        index('cards_created_by_index').on(table.createdBy),
    ],
);

export const labels = pgTable(
    'labels',
    {
        id: id(),
        boardId: integer('board_id')
            .notNull()
            .references(() => boards.id, { onDelete: 'cascade' }),
        name: varchar('name', { length: 255 }),
        color: varchar('color', { length: 20 }).notNull(),
        ...timestamps,
    },
    (table) => [index('labels_board_id_index').on(table.boardId)],
);

export const cardLabel = pgTable(
    'card_label',
    {
        id: id(),
        cardId: integer('card_id')
            .notNull()
            .references(() => cards.id, { onDelete: 'cascade' }),
        labelId: integer('label_id')
            .notNull()
            .references(() => labels.id, { onDelete: 'cascade' }),
    },
    (table) => [
        uniqueIndex('card_label_card_id_label_id_unique').on(table.cardId, table.labelId),

        // O único acima começa por card_id; apagar uma etiqueta procura por label_id.
        index('card_label_label_id_index').on(table.labelId),
    ],
);

export const cardUser = pgTable(
    'card_user',
    {
        id: id(),
        cardId: integer('card_id')
            .notNull()
            .references(() => cards.id, { onDelete: 'cascade' }),
        userId: integer('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
    },
    (table) => [
        uniqueIndex('card_user_card_id_user_id_unique').on(table.cardId, table.userId),
        index('card_user_user_id_index').on(table.userId),
    ],
);

export const comments = pgTable(
    'comments',
    {
        id: id(),
        cardId: integer('card_id')
            .notNull()
            .references(() => cards.id, { onDelete: 'cascade' }),
        userId: integer('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        body: text('body').notNull(),
        ...timestamps,
    },
    (table) => [
        index('comments_card_id_created_at_index').on(table.cardId, table.createdAt),

        // Apagar uma conta leva os comentários dela junto (CASCADE).
        index('comments_user_id_index').on(table.userId),
    ],
);

export const checklists = pgTable(
    'checklists',
    {
        id: id(),
        cardId: integer('card_id')
            .notNull()
            .references(() => cards.id, { onDelete: 'cascade' }),
        title: varchar('title', { length: 255 }).notNull(),
        position: doublePrecision('position').notNull().default(0),
        ...timestamps,
    },
    (table) => [index('checklists_card_id_position_index').on(table.cardId, table.position)],
);

export const checklistItems = pgTable(
    'checklist_items',
    {
        id: id(),
        checklistId: integer('checklist_id')
            .notNull()
            .references(() => checklists.id, { onDelete: 'cascade' }),
        content: varchar('content', { length: 500 }).notNull(),
        isDone: boolean('is_done').notNull().default(false),
        position: doublePrecision('position').notNull().default(0),
        ...timestamps,
    },
    (table) => [index('checklist_items_checklist_id_position_index').on(table.checklistId, table.position)],
);

export const activities = pgTable(
    'activities',
    {
        id: id(),
        boardId: integer('board_id')
            .notNull()
            .references(() => boards.id, { onDelete: 'cascade' }),
        cardId: integer('card_id').references(() => cards.id, { onDelete: 'cascade' }),
        userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
        type: varchar('type', { length: 40 }).notNull(),

        // text e não varchar(255): a descrição carrega títulos de card, que
        // podem ter até 500 caracteres.
        description: text('description').notNull(),
        properties: jsonb('properties').$type<Record<string, unknown>>(),
        ...timestamps,
    },
    (table) => [
        index('activities_board_id_created_at_index').on(table.boardId, table.createdAt),
        index('activities_card_id_created_at_index').on(table.cardId, table.createdAt),

        // Apagar uma conta anula o autor do histórico dela (SET NULL). O
        // histórico não tem faxina, só cresce: varrê-lo inteiro custa cada vez mais.
        index('activities_user_id_index').on(table.userId),
    ],
);

/* -------------------------------------------------------------------------- */
/* Relações (para db.query.*.findMany({ with }))                               */
/* -------------------------------------------------------------------------- */

export const usersRelations = relations(users, ({ many }) => ({
    memberships: many(boardUser),
    ownedBoards: many(boards),
    assignments: many(cardUser),
    comments: many(comments),
    sessions: many(sessions),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
    user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const boardsRelations = relations(boards, ({ one, many }) => ({
    owner: one(users, { fields: [boards.ownerId], references: [users.id] }),
    memberships: many(boardUser),
    lists: many(boardLists),
    cards: many(cards),
    labels: many(labels),
    activities: many(activities),
}));

export const boardUserRelations = relations(boardUser, ({ one }) => ({
    board: one(boards, { fields: [boardUser.boardId], references: [boards.id] }),
    user: one(users, { fields: [boardUser.userId], references: [users.id] }),
}));

export const boardListsRelations = relations(boardLists, ({ one, many }) => ({
    board: one(boards, { fields: [boardLists.boardId], references: [boards.id] }),
    cards: many(cards),
}));

export const cardsRelations = relations(cards, ({ one, many }) => ({
    board: one(boards, { fields: [cards.boardId], references: [boards.id] }),
    list: one(boardLists, { fields: [cards.boardListId], references: [boardLists.id] }),
    creator: one(users, { fields: [cards.createdBy], references: [users.id] }),
    labels: many(cardLabel),
    members: many(cardUser),
    comments: many(comments),
    checklists: many(checklists),
    activities: many(activities),
}));

export const labelsRelations = relations(labels, ({ one, many }) => ({
    board: one(boards, { fields: [labels.boardId], references: [boards.id] }),
    cards: many(cardLabel),
}));

export const cardLabelRelations = relations(cardLabel, ({ one }) => ({
    card: one(cards, { fields: [cardLabel.cardId], references: [cards.id] }),
    label: one(labels, { fields: [cardLabel.labelId], references: [labels.id] }),
}));

export const cardUserRelations = relations(cardUser, ({ one }) => ({
    card: one(cards, { fields: [cardUser.cardId], references: [cards.id] }),
    user: one(users, { fields: [cardUser.userId], references: [users.id] }),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
    card: one(cards, { fields: [comments.cardId], references: [cards.id] }),
    author: one(users, { fields: [comments.userId], references: [users.id] }),
}));

export const checklistsRelations = relations(checklists, ({ one, many }) => ({
    card: one(cards, { fields: [checklists.cardId], references: [cards.id] }),
    items: many(checklistItems),
}));

export const checklistItemsRelations = relations(checklistItems, ({ one }) => ({
    checklist: one(checklists, { fields: [checklistItems.checklistId], references: [checklists.id] }),
}));

export const activitiesRelations = relations(activities, ({ one }) => ({
    board: one(boards, { fields: [activities.boardId], references: [boards.id] }),
    card: one(cards, { fields: [activities.cardId], references: [cards.id] }),
    user: one(users, { fields: [activities.userId], references: [users.id] }),
}));

export type UserRow = typeof users.$inferSelect;
export type BoardRow = typeof boards.$inferSelect;
export type BoardListRow = typeof boardLists.$inferSelect;
export type CardRow = typeof cards.$inferSelect;
export type LabelRow = typeof labels.$inferSelect;
export type CommentRow = typeof comments.$inferSelect;
export type ChecklistRow = typeof checklists.$inferSelect;
export type ChecklistItemRow = typeof checklistItems.$inferSelect;
export type ActivityRow = typeof activities.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
