import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { acceptBoardInvitation, revokeBoardInvitation } from '@/server/actions/invitations';
import { register } from '@/server/actions/auth';
import { currentSession } from '@/server/auth/session';
import { db } from '@/server/db';
import { activities, boardInvitations, boardUser, users, type BoardRow, type UserRow } from '@/server/db/schema';
import { boardInvitationMail } from '@/server/mail/board-invitation';
import { sentMail } from '@/server/mail/mailer';
import { loadBoardPage } from '@/server/queries/board';
import {
    INVITATION_MESSAGES,
    acceptInvitation,
    pendingInvitations,
    previewInvitation,
    pruneExpiredInvitations,
    resendInvitation,
    revokeInvitation,
} from '@/server/services/invitations';
import { addBoardMember } from '@/server/services/members';
import { expectHttpError } from './support/assertions';
import { addMember, createBoard, createUser } from './support/factories';

/**
 * Convites por e-mail para quem ainda não tem conta: o convite, o link, o
 * aceite (logado ou no cadastro), reenviar, cancelar e as travas.
 *
 * As actions rodam de verdade; só o `next/headers` é dublê (um pote de
 * cookies em memória), como em tests/parity/auth.test.ts.
 */
const jar = vi.hoisted(() => {
    const store = new Map<string, string>();

    return {
        store,
        get: (name: string) => (store.has(name) ? { name, value: store.get(name)! } : undefined),
        has: (name: string) => store.has(name),
        set: (name: string, value: string) => {
            store.set(name, value);
        },
        delete: (name: string) => {
            store.delete(name);
        },
        getAll: () => [...store].map(([name, value]) => ({ name, value })),
    };
});

vi.mock('next/headers', () => ({
    cookies: async () => jar,
    headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.7', 'user-agent': 'vitest' }),
}));
vi.mock('next/cache', () => ({ refresh: vi.fn() }));

const NOW = new Date('2026-10-13T15:00:00Z');

beforeEach(() => {
    jar.store.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

/** Para onde a action redirecionou (o `assertRedirect`), ou null. */
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

/** O token do último e-mail de convite (o link /invite/<token>). */
function lastToken(): string {
    const text = sentMail.at(-1)?.text ?? '';
    const match = /\/invite\/([A-Za-z0-9_-]+)/.exec(text);

    if (!match?.[1]) throw new Error(`nenhum link de convite no e-mail: ${text}`);

    return match[1];
}

async function invite(owner: UserRow, board: BoardRow, email = 'nova@taskon.test', role: 'admin' | 'member' = 'member') {
    await addBoardMember(owner, board.id, { email, role });

    return lastToken();
}

async function roleIn(board: BoardRow, user: Pick<UserRow, 'id'>) {
    const [row] = await db
        .select({ role: boardUser.role })
        .from(boardUser)
        .where(and(eq(boardUser.boardId, board.id), eq(boardUser.userId, user.id)));

    return row?.role ?? null;
}

async function activitiesOf(board: BoardRow, type: string) {
    return db.select().from(activities).where(and(eq(activities.boardId, board.id), eq(activities.type, type)));
}

/** Loga a pessoa no pote de cookies, como se ela tivesse entrado pelo formulário. */
async function signIn(user: UserRow) {
    const { startSession } = await import('@/server/auth/session');

    await startSession(user.id, false);
}

describe('convidar quem não tem conta', () => {
    it('cria o convite, manda o e-mail com o link e registra no histórico', async () => {
        const owner = await createUser({ name: 'Victor Dono' });
        const board = await createBoard(owner, { title: 'Lançamento' });

        const result = await addBoardMember(owner, board.id, { email: ' Nova@Taskon.test ', role: 'admin' });

        expect(result).toEqual({ kind: 'invited', email: 'nova@taskon.test' });
        expect(sentMail).toHaveLength(1);
        expect(sentMail[0]).toMatchObject({ to: 'nova@taskon.test' });
        expect(sentMail[0]?.subject).toBe('Victor Dono convidou você para o quadro "Lançamento" no Taskon');
        expect(sentMail[0]?.html).toContain('http://taskon.test/invite/');

        const [pending] = await pendingInvitations(board.id);

        expect(pending).toMatchObject({ email: 'nova@taskon.test', role: 'admin', invited_by: 'Victor Dono' });
        expect(pending?.expires_at).toBe('2026-10-20T12:00:00-03:00');

        const [entry] = await activitiesOf(board, 'member.invited');

        expect(entry).toMatchObject({ userId: owner.id, description: 'convidou nova@taskon.test para o quadro' });
    });

    it('guarda só o hash do token, nunca o token do link', async () => {
        const owner = await createUser();
        const board = await createBoard(owner);
        const token = await invite(owner, board);

        const [row] = await db.select().from(boardInvitations);

        expect(row?.token).toHaveLength(64);
        expect(row?.token).not.toBe(token);
    });

    it('convidar de novo renova o link: o antigo deixa de valer e o histórico não repete', async () => {
        const owner = await createUser();
        const board = await createBoard(owner);
        const first = await invite(owner, board);
        const second = await invite(owner, board, 'nova@taskon.test', 'admin');

        expect(second).not.toBe(first);
        expect(await previewInvitation(first)).toBeNull();
        expect(await previewInvitation(second)).toMatchObject({ role: 'admin' });
        expect(await db.$count(boardInvitations)).toBe(1);
        expect(await activitiesOf(board, 'member.invited')).toHaveLength(1);
    });

    it('membro comum não convida, não reenvia e não cancela', async () => {
        const owner = await createUser();
        const board = await createBoard(owner);
        const member = await createUser();
        await addMember(board, member);
        await invite(owner, board);
        const [pending] = await pendingInvitations(board.id);

        await expectHttpError(addBoardMember(member, board.id, { email: 'x@taskon.test', role: 'member' }), 403);
        await expectHttpError(resendInvitation(member, pending!.id), 403);
        await expectHttpError(revokeInvitation(member, pending!.id), 403);
        await expectHttpError(revokeInvitation(owner, 999_999), 404);
    });

    it('se o e-mail não sai, nenhum convite fica pendente', async () => {
        const owner = await createUser();
        const board = await createBoard(owner);

        vi.stubEnv('MAIL_MAILER', 'resend');
        vi.stubEnv('RESEND_API_KEY', '');

        const error = await expectHttpError(addBoardMember(owner, board.id, { email: 'nova@taskon.test', role: 'member' }), 500);

        expect(error.message).toBe(INVITATION_MESSAGES.mailFailed);
        expect(await db.$count(boardInvitations)).toBe(0);
        expect(await activitiesOf(board, 'member.invited')).toHaveLength(0);
    });

    it('um reenvio que falha não derruba o link que a pessoa já tem', async () => {
        const owner = await createUser();
        const board = await createBoard(owner);
        const token = await invite(owner, board);
        const [pending] = await pendingInvitations(board.id);

        vi.stubEnv('MAIL_MAILER', 'resend');
        vi.stubEnv('RESEND_API_KEY', '');

        await expectHttpError(resendInvitation(owner, pending!.id), 500);

        expect(await previewInvitation(token)).not.toBeNull();
    });

    it('tem teto de convites por hora para quem convida (o botão não vira disparador de e-mail)', async () => {
        const owner = await createUser();
        const board = await createBoard(owner);

        for (let i = 0; i < 20; i++) {
            await addBoardMember(owner, board.id, { email: `pessoa${i}@fora.test`, role: 'member' });
        }

        await expectHttpError(addBoardMember(owner, board.id, { email: 'mais-uma@fora.test', role: 'member' }), 429);
    });

    it('quem administra vê os convites pendentes no quadro; membro comum não', async () => {
        const owner = await createUser();
        const board = await createBoard(owner);
        const member = await createUser();
        await addMember(board, member);
        await invite(owner, board);

        expect((await loadBoardPage(owner, board.id)).board.invitations).toHaveLength(1);
        expect((await loadBoardPage(member, board.id)).board.invitations).toEqual([]);
    });

    it('adicionar a conta direto (ela se cadastrou sem o link) apaga o convite pendente', async () => {
        const owner = await createUser();
        const board = await createBoard(owner);
        const token = await invite(owner, board);
        await createUser({ email: 'nova@taskon.test' });

        const result = await addBoardMember(owner, board.id, { email: 'nova@taskon.test', role: 'member' });

        expect(result.kind).toBe('added');
        expect(await previewInvitation(token)).toBeNull();
    });
});

describe('aceitar o convite', () => {
    it('quem tem o link entra no quadro com o papel do convite, e o convite se gasta', async () => {
        const owner = await createUser({ name: 'Victor Dono' });
        const board = await createBoard(owner, { title: 'Lançamento' });
        const token = await invite(owner, board, 'nova@taskon.test', 'admin');
        const guest = await createUser({ email: 'nova@taskon.test' });

        const joined = await acceptInvitation(guest, token);

        expect(joined).toEqual({ boardId: board.id, boardTitle: 'Lançamento', alreadyMember: false });
        expect(await roleIn(board, guest)).toBe('admin');
        expect(await db.$count(boardInvitations)).toBe(0);

        const [entry] = await activitiesOf(board, 'member.joined');

        expect(entry).toMatchObject({ userId: guest.id, description: 'entrou no quadro pelo convite de Victor Dono' });

        await expectHttpError(acceptInvitation(guest, token), 404);
    });

    it('quem já participava só gasta o convite, sem mudar de papel', async () => {
        const owner = await createUser();
        const board = await createBoard(owner);
        const member = await createUser();
        await addMember(board, member, 'member');
        const token = await invite(owner, board, 'outra@taskon.test', 'admin');

        expect(await acceptInvitation(member, token)).toMatchObject({ alreadyMember: true });
        expect(await roleIn(board, member)).toBe('member');
        expect(await activitiesOf(board, 'member.joined')).toHaveLength(0);
    });

    it('convite vencido, cancelado ou inventado não abre nada', async () => {
        const owner = await createUser();
        const board = await createBoard(owner);
        const guest = await createUser();
        const expired = await invite(owner, board, 'a@fora.test');
        const revoked = await invite(owner, board, 'b@fora.test');
        const [, second] = await pendingInvitations(board.id);

        await revokeInvitation(owner, second!.id);
        expect(await activitiesOf(board, 'member.invite_revoked')).toHaveLength(1);

        vi.setSystemTime(new Date(NOW.getTime() + 8 * 86_400_000));

        expect(await previewInvitation(expired)).toBeNull();
        expect(await previewInvitation(revoked)).toBeNull();
        expect(await previewInvitation('inventado')).toBeNull();
        await expectHttpError(acceptInvitation(guest, expired), 404);
        await expectHttpError(acceptInvitation(guest, 'x'.repeat(43)), 404);
        expect(await roleIn(board, guest)).toBeNull();

        await pruneExpiredInvitations();
        expect(await db.$count(boardInvitations)).toBe(0);
    });

    it('pela action: leva ao quadro com aviso; sem sessão pede login', async () => {
        const owner = await createUser();
        const board = await createBoard(owner, { title: 'Lançamento' });
        const token = await invite(owner, board);
        const guest = await createUser();

        expect(await acceptBoardInvitation({ token })).toMatchObject({ ok: false, status: 401 });

        await signIn(guest);

        expect(await redirectOf(acceptBoardInvitation({ token }))).toBe(`/boards/${board.id}`);
        expect(jar.store.get('taskon_flash')).toContain('Você entrou no quadro');
        expect(await roleIn(board, guest)).toBe('member');
    });

    it('cancelar pela action exige administrar o quadro', async () => {
        const owner = await createUser();
        const board = await createBoard(owner);
        await invite(owner, board);
        const [pending] = await pendingInvitations(board.id);
        const outsider = await createUser();

        await signIn(outsider);

        expect(await revokeBoardInvitation({ invitationId: pending!.id })).toMatchObject({ ok: false, status: 403 });
        expect(await db.$count(boardInvitations)).toBe(1);
    });
});

describe('cadastro pelo link do convite', () => {
    it('a conta nasce dentro do quadro e a pessoa cai nele', async () => {
        const owner = await createUser();
        const board = await createBoard(owner, { title: 'Lançamento' });
        const token = await invite(owner, board, 'nova@taskon.test', 'admin');

        const target = await redirectOf(
            register({
                name: 'Nova Pessoa',
                email: 'nova@taskon.test',
                password: 'senha-segura',
                password_confirmation: 'senha-segura',
                invite: token,
            }),
        );

        const [created] = await db.select().from(users).where(eq(users.email, 'nova@taskon.test'));

        expect(target).toBe(`/boards/${board.id}`);
        expect((await currentSession())?.user.id).toBe(created!.id);
        expect(await roleIn(board, created!)).toBe('admin');
        expect(jar.store.get('taskon_flash')).toContain('Você entrou no quadro');
    });

    it('com convite que não vale mais, a conta é criada do mesmo jeito e vai para o painel', async () => {
        const target = await redirectOf(
            register({
                name: 'Nova Pessoa',
                email: 'nova@taskon.test',
                password: 'senha-segura',
                password_confirmation: 'senha-segura',
                invite: 'x'.repeat(43),
            }),
        );

        expect(target).toBe('/dashboard');
        expect(await db.$count(users)).toBe(1);
        expect(jar.store.get('taskon_flash')).toContain('Este convite não vale mais');
    });
});

describe('e-mail do convite', () => {
    it('escapa o que veio de gente', () => {
        const mail = boardInvitationMail({
            inviterName: '<b>Mallory</b>',
            boardTitle: '<a href="https://evil.test">Quadro</a>',
            role: 'member',
            url: 'http://taskon.test/invite/abc',
            expiresInDays: 7,
        });

        expect(mail.html).not.toContain('<a href="https://evil.test">');
        expect(mail.html).toContain('&lt;a href=&quot;https://evil.test&quot;&gt;Quadro&lt;/a&gt;');
        expect(mail.html).not.toContain('<b>Mallory</b>');
        expect(mail.text).toContain('http://taskon.test/invite/abc');
    });
});
