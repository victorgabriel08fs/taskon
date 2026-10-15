import { randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminEvent } from '@/types';
import { describeAdminEvent } from '@/components/admin/admin-history';
import { config } from '@/server/config';
import { db } from '@/server/db';
import { adminEvents, emailVerifications, sessions, users, type UserRow } from '@/server/db/schema';
import { sentMail } from '@/server/mail/mailer';
import { adminAccess } from '@/server/policies/admin';
import { blockUser, grantAdmin } from '@/server/services/admin';
import { confirmEmailVerification, sendEmailVerification } from '@/server/services/email-verification';
import { expectHttpError } from '../support/assertions';
import { createUser } from '../support/factories';

/**
 * Revisão (lente: testes) — o que a suíte original afirma só pela leitura do
 * código:
 *
 *  - "Tudo em transação com o adminEvents": se o histórico não puder ser
 *    gravado, a mudança de poder não acontece (bloqueio, sessões, admin) — e a
 *    ativação do nativo também não (nem o token é gasto);
 *  - "5 por hora" conta LINKS: os cliques recusados pelo intervalo de 60 s não
 *    gastam a cota da hora;
 *  - a frase de cada tipo de evento do histórico (função pura da tela).
 */
vi.mock('next/cache', () => ({ refresh: vi.fn() }));

const NOW = new Date('2026-10-14T15:00:00Z');
const NATIVE_EMAIL = config.admin.nativeEmails[0]!;

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
});

afterEach(() => {
    vi.useRealTimers();
});

/** Faz toda gravação em admin_events falhar enquanto `run` roda. */
async function withBrokenHistory(run: () => Promise<void>): Promise<void> {
    await db.execute(sql.raw('alter table admin_events add constraint review_no_history check (false) not valid'));

    try {
        await run();
    } finally {
        await db.execute(sql.raw('alter table admin_events drop constraint review_no_history'));
    }
}

async function reload(user: Pick<UserRow, 'id'>): Promise<UserRow> {
    const [row] = await db.select().from(users).where(eq(users.id, user.id));

    return row!;
}

function lastToken(): string {
    const match = /\/verify-email\/([A-Za-z0-9_-]+)/.exec(sentMail.at(-1)?.text ?? '');

    if (!match?.[1]) throw new Error('nenhum link de confirmação no e-mail');

    return match[1];
}

describe('mudança de poder sem rastro não acontece', () => {
    it('bloquear: sem o histórico, a conta não é bloqueada e as sessões continuam', async () => {
        const native = await createUser({ email: NATIVE_EMAIL, emailVerifiedAt: NOW });
        const target = await createUser();

        await db.insert(sessions).values({
            id: randomBytes(32).toString('hex'),
            userId: target.id,
            lastActivityAt: NOW,
            expiresAt: new Date(NOW.getTime() + 86_400_000),
        });

        await withBrokenHistory(async () => {
            await expect(blockUser(native, target.id)).rejects.toThrow();
        });

        expect(await reload(target)).toMatchObject({ blockedAt: null, blockedBy: null });
        expect(await db.$count(sessions, eq(sessions.userId, target.id))).toBe(1);
    });

    it('conceder admin: sem o histórico, a conta continua comum', async () => {
        const native = await createUser({ email: NATIVE_EMAIL, emailVerifiedAt: NOW });
        const target = await createUser();

        await withBrokenHistory(async () => {
            await expect(grantAdmin(native, target.id)).rejects.toThrow();
        });

        expect((await reload(target)).isAdmin).toBe(false);
    });

    it('ativar o nativo: sem o histórico, o e-mail não fica confirmado e o link continua valendo', async () => {
        const native = await createUser({ email: NATIVE_EMAIL });

        await sendEmailVerification(native);
        const token = lastToken();

        await withBrokenHistory(async () => {
            await expect(confirmEmailVerification(token)).rejects.toThrow();
        });

        expect(adminAccess(await reload(native))).toBe('pending');
        expect(await db.$count(emailVerifications)).toBe(1);

        // Com o histórico de volta, o mesmo link ativa.
        expect(await confirmEmailVerification(token)).toEqual({ userId: native.id, becameNativeAdmin: true });
        expect(await db.$count(adminEvents)).toBe(1);
    });
});

describe('a cota da hora conta links, não cliques', () => {
    it('cliques recusados pelo intervalo de 60 s não gastam os 5 links da hora', async () => {
        const user = await createUser();

        await sendEmailVerification(user);

        // Clique nervoso: dez pedidos dentro do intervalo, todos recusados.
        for (let i = 0; i < 10; i++) await expectHttpError(sendEmailVerification(user), 429);

        // Os outros quatro links da hora continuam disponíveis.
        for (let i = 1; i <= 4; i++) {
            vi.setSystemTime(new Date(NOW.getTime() + i * 61_000));
            await sendEmailVerification(user);
        }

        expect(sentMail).toHaveLength(5);

        vi.setSystemTime(new Date(NOW.getTime() + 5 * 61_000));
        await expectHttpError(sendEmailVerification(user), 429);
        expect(sentMail).toHaveLength(5);
    });
});

describe('o histórico na tela (describeAdminEvent)', () => {
    const event = (type: AdminEvent['type'], actor: string | null): AdminEvent => ({
        id: 1,
        type,
        actor,
        target_name: 'Ana Souza',
        target_email: 'ana@example.com',
        created_at: '2026-10-14T12:00:00-03:00',
    });

    it('cada tipo vira uma frase — e quem fez some com a conta excluída', () => {
        expect(describeAdminEvent(event('admin.granted', 'Victor'))).toEqual({
            actor: 'Victor',
            action: 'concedeu admin a',
            target: 'Ana Souza',
        });
        expect(describeAdminEvent(event('admin.revoked', 'Victor')).action).toBe('tirou o admin de');
        expect(describeAdminEvent(event('user.blocked', 'Victor')).action).toBe('bloqueou');
        expect(describeAdminEvent(event('user.unblocked', 'Victor')).action).toBe('desbloqueou');
        expect(describeAdminEvent(event('user.blocked', null)).actor).toBe('Uma conta excluída');

        // A ativação não tem alvo: é a própria conta nativa (ator = alvo).
        expect(describeAdminEvent(event('admin.activated', 'Ana Souza'))).toEqual({
            actor: 'Ana Souza',
            action: 'ativou a administração',
            target: null,
        });
        expect(describeAdminEvent(event('admin.activated', null)).actor).toBe('Ana Souza');
    });
});
