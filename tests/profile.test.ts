import { count, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { verifyPassword } from '@/server/auth/password';
import { db } from '@/server/db';
import {
    activities,
    boardUser,
    boards,
    cardUser,
    cards,
    comments,
    passwordResetTokens,
    sessions,
    users,
} from '@/server/db/schema';
import { authUserResource } from '@/server/resources/common';
import { AUTH_MESSAGES } from '@/server/services/auth';
import { changePassword, deleteAccount, updateProfile } from '@/server/services/profile';
import { expectHttpError } from './support/assertions';
import { addMember, assign, createBoard, createCard, createList, createUser } from './support/factories';

async function reload(id: number) {
    const [row] = await db.select().from(users).where(eq(users.id, id));

    return row;
}

describe('perfil', () => {
    it('atualiza nome, cargo, e-mail e cor — e o e-mail novo deixa de ser verificado', async () => {
        const user = await createUser({ emailVerifiedAt: new Date('2026-01-01T12:00:00Z') });

        const updated = await updateProfile(user, {
            name: 'Ana Souza',
            email: 'ana.souza@example.com',
            title: 'Designer',
            avatar_color: 'rose',
        });

        expect(updated).toMatchObject({
            name: 'Ana Souza',
            email: 'ana.souza@example.com',
            title: 'Designer',
            avatarColor: 'rose',
            emailVerifiedAt: null,
        });
    });

    it('mantém a verificação quando o e-mail não muda', async () => {
        const verifiedAt = new Date('2026-01-01T12:00:00Z');
        const user = await createUser({ emailVerifiedAt: verifiedAt });

        const updated = await updateProfile(user, {
            name: 'Outro nome',
            email: user.email,
            title: null,
            avatar_color: 'teal',
        });

        expect(updated.emailVerifiedAt?.getTime()).toBe(verifiedAt.getTime());
        expect(updated.title).toBeNull();
    });

    it('recusa o e-mail de outra pessoa, mas aceita o próprio', async () => {
        await createUser({ email: 'ocupado@example.com' });
        const user = await createUser({ email: 'meu@example.com' });

        const error = await expectHttpError(
            updateProfile(user, { name: 'Eu', email: 'ocupado@example.com', title: null, avatar_color: 'violet' }),
            422,
            'email',
        );

        expect(error.errors?.email).toBe(AUTH_MESSAGES.emailTaken);
        expect((await reload(user.id))?.email).toBe('meu@example.com');

        await expect(
            updateProfile(user, { name: 'Eu', email: 'meu@example.com', title: null, avatar_color: 'violet' }),
        ).resolves.toMatchObject({ email: 'meu@example.com' });
    });

    it('trocar o e-mail invalida um link de redefinição pedido para o endereço antigo', async () => {
        const user = await createUser({ email: 'antigo@example.com' });

        await db.insert(passwordResetTokens).values({ email: 'antigo@example.com', token: 'f'.repeat(64) });

        await updateProfile(user, { name: user.name, email: 'novo@example.com', title: null, avatar_color: 'violet' });

        expect(await db.select().from(passwordResetTokens)).toHaveLength(0);
    });

    /**
     * Bug do legado: `auth.user` não trazia `title`, então a tela de perfil
     * abria com o cargo vazio e salvar sem mexer nele APAGAVA o cargo. O
     * AuthUser daqui carrega o cargo, e o formulário nasce preenchido.
     */
    it('o usuário logado chega à tela com o cargo — salvar não o apaga mais', async () => {
        const user = await createUser({ title: 'Product Owner' });
        const shared = authUserResource(user);

        expect(shared.title).toBe('Product Owner');

        // O que o formulário envia sem a pessoa tocar no campo.
        const updated = await updateProfile(user, {
            name: shared.name,
            email: shared.email,
            title: shared.title,
            avatar_color: shared.avatar_color,
        });

        expect(updated.title).toBe('Product Owner');
    });
});

describe('senha', () => {
    it('troca a senha conferindo a atual', async () => {
        const user = await createUser();

        await changePassword(user, { current_password: 'password', password: 'nova-senha-123' });

        const fresh = await reload(user.id);

        expect(await verifyPassword('nova-senha-123', fresh!.password)).toBe(true);
    });

    it('recusa a senha atual errada sem trocar nada', async () => {
        const user = await createUser();

        const error = await expectHttpError(
            changePassword(user, { current_password: 'errada', password: 'nova-senha-123' }),
            422,
            'current_password',
        );

        expect(error.errors?.current_password).toBe('A senha atual está incorreta.');
        expect(await verifyPassword('password', (await reload(user.id))!.password)).toBe(true);
    });

    it('limita a 6 tentativas por minuto por pessoa', async () => {
        const user = await createUser();

        for (let attempt = 1; attempt <= 6; attempt++) {
            await expectHttpError(
                changePassword(user, { current_password: 'errada', password: 'nova-senha-123' }),
                422,
                'current_password',
            );
        }

        // A 7ª nem chega a conferir a senha — mesmo a certa.
        await expectHttpError(changePassword(user, { current_password: 'password', password: 'nova-senha-123' }), 429);

        // O limite é de cada pessoa.
        const other = await createUser();

        await changePassword(other, { current_password: 'password', password: 'nova-senha-123' });
    });
});

describe('exclusão da conta', () => {
    it('recusa a senha errada e não apaga nada', async () => {
        const user = await createUser();

        const error = await expectHttpError(deleteAccount(user, 'errada'), 422, 'password');

        expect(error.errors?.password).toBe('A senha está incorreta.');
        expect(await reload(user.id)).toBeDefined();
    });

    it('apaga a conta e tudo que é dela; nos quadros alheios, só a participação', async () => {
        const user = await createUser({ email: 'sai@example.com' });
        const other = await createUser();

        // Quadro da própria pessoa: vai inteiro.
        const own = await createBoard(user);
        const ownList = await createList(own);

        await createCard(ownList);

        // Quadro de outra pessoa, onde ela participa, criou card e comentou.
        const shared = await createBoard(other);
        const sharedList = await createList(shared);
        const card = await createCard(sharedList, { createdBy: user.id });

        await addMember(shared, user);
        await assign(card, user);
        await db.insert(comments).values({ cardId: card.id, userId: user.id, body: 'oi' });
        await db.insert(activities).values({ boardId: shared.id, userId: user.id, type: 'card.created', description: 'criou' });

        await db.insert(sessions).values({ id: 'c'.repeat(64), userId: user.id, expiresAt: new Date(Date.now() + 60_000) });
        await db.insert(passwordResetTokens).values({ email: 'sai@example.com', token: 'e'.repeat(64) });

        await deleteAccount(user, 'password');

        expect(await reload(user.id)).toBeUndefined();
        expect(await db.select().from(boards).where(eq(boards.id, own.id))).toHaveLength(0);
        expect(await db.select().from(sessions)).toHaveLength(0);
        expect(await db.select().from(passwordResetTokens)).toHaveLength(0);

        // O quadro alheio continua, sem a pessoa.
        expect(await db.select().from(boards).where(eq(boards.id, shared.id))).toHaveLength(1);

        const [members] = await db.select({ n: count() }).from(boardUser).where(eq(boardUser.boardId, shared.id));

        expect(members?.n).toBe(1);
        expect(await db.select().from(cardUser).where(eq(cardUser.cardId, card.id))).toHaveLength(0);
        expect(await db.select().from(comments).where(eq(comments.cardId, card.id))).toHaveLength(0);

        const [orphan] = await db.select().from(cards).where(eq(cards.id, card.id));

        expect(orphan?.createdBy).toBeNull();

        const [activity] = await db.select().from(activities).where(eq(activities.boardId, shared.id));

        expect(activity?.userId).toBeNull();
    });
});
