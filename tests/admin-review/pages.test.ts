import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { isValidElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminPanelData, EmailVerificationPreview } from '@/types';
import { proxy } from '@/proxy';
import { startSession } from '@/server/auth/session';
import { config } from '@/server/config';
import { db } from '@/server/db';
import { emailVerifications, sessions, users, type UserRow } from '@/server/db/schema';
import { sentMail } from '@/server/mail/mailer';
import { authUserResource } from '@/server/resources/common';
import { previewEmailVerification, sendEmailVerification } from '@/server/services/email-verification';
import { createUser } from '../support/factories';

/**
 * Revisão (lente: testes) — as regras de TELA do pedido, na camada da página:
 *
 *  - /admin: sem sessão → login; conta comum → 404; nativo pendente → só a
 *    tela de ativação; admin ativo → o painel, com busca/filtro/página da URL;
 *  - /verify-email/[token]: pública, mostra o e-mail e NÃO gasta o token no
 *    GET (os scanners de e-mail abrem o link antes da pessoa);
 *  - o proxy protege /admin e deixa /verify-email aberto;
 *  - o item "Administração" do menu depende de `authUserResource().admin`.
 *
 * A sessão é a de verdade (o `currentSession` com o filtro do bloqueio): só o
 * `next/headers` é dublê, com um pote de cookies em memória.
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
    // O proxy anota o caminho pedido em x-taskon-path; o requireUser o devolve no ?next=.
    headers: async () =>
        new Headers({ 'x-forwarded-for': '203.0.113.31', 'user-agent': 'vitest', 'x-taskon-path': '/admin?filter=blocked' }),
}));
vi.mock('next/cache', () => ({ refresh: vi.fn() }));

const NOW = new Date('2026-10-14T15:00:00Z');
const NATIVE_EMAIL = config.admin.nativeEmails[0]!;

beforeEach(() => {
    jar.store.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
});

afterEach(() => {
    vi.useRealTimers();
});

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

const redirectTarget = (digest: string | null) =>
    digest?.startsWith('NEXT_REDIRECT') ? (digest.split(';')[2] ?? null) : null;

async function adminPage(searchParams: Record<string, string | string[] | undefined> = {}) {
    const { default: AdminPage } = await import('@/app/(app)/admin/page');

    return AdminPage({ searchParams: Promise.resolve(searchParams) });
}

async function verifyEmailPage(token: string) {
    const { default: VerifyEmailPage } = await import('@/app/verify-email/[token]/page');

    return VerifyEmailPage({ params: Promise.resolve({ token }) });
}

/** O token cru só existe no e-mail. */
function lastToken(): string {
    const match = /\/verify-email\/([A-Za-z0-9_-]+)/.exec(sentMail.at(-1)?.text ?? '');

    if (!match?.[1]) throw new Error('nenhum link de confirmação no e-mail');

    return match[1];
}

async function signIn(user: Pick<UserRow, 'id'>): Promise<void> {
    await startSession(user.id, false);
}

describe('GET /admin', () => {
    it('sem sessão, vai para o login guardando o destino', async () => {
        const target = redirectTarget(await digestOf(adminPage()));

        expect(target).toBe(`/login?next=${encodeURIComponent('/admin?filter=blocked')}`);
    });

    it('conta comum recebe 404 — o painel não existe para ela', async () => {
        await signIn(await createUser());

        expect(await digestOf(adminPage())).toMatch(/^NEXT_HTTP_ERROR_FALLBACK;404/);
    });

    it('admin bloqueado com o cookie ainda no navegador não abre o painel (vai para o login)', async () => {
        const admin = await createUser({ isAdmin: true });

        await signIn(admin);
        // Bloqueio gravado por fora, sem apagar a sessão: a defesa em profundidade segura sozinha.
        await db.update(users).set({ blockedAt: NOW }).where(eq(users.id, admin.id));

        expect(redirectTarget(await digestOf(adminPage()))).toMatch(/^\/login/);
    });

    it('nativo pendente vê só a tela de ativação, com a validade do link', async () => {
        const { AdminActivation } = await import('@/components/admin/admin-activation');

        await signIn(await createUser({ email: NATIVE_EMAIL }));

        const element = (await adminPage({ q: 'x' })) as ReactElement<{ expiresInMinutes: number }>;

        expect(isValidElement(element)).toBe(true);
        expect(element.type).toBe(AdminActivation);
        expect(element.props.expiresInMinutes).toBe(config.admin.emailVerificationMinutes);
    });

    it.each([
        ['nativo', { email: NATIVE_EMAIL, emailVerifiedAt: NOW }, 'native'],
        ['admin concedido', { isAdmin: true }, 'admin'],
    ] as const)('%s abre o painel, com busca, filtro e página lidos da URL', async (_label, overrides, access) => {
        const { AdminPanel } = await import('@/components/admin/admin-panel');
        const viewer = await createUser({ name: 'Quem Administra', ...overrides });
        const blocked = await createUser({ name: 'Ana Bloqueada', blockedAt: NOW, blockedBy: viewer.id });

        await createUser({ name: 'Ana Ativa' });
        await signIn(viewer);

        const element = (await adminPage({ q: '  ana ', filter: 'blocked', page: '7' })) as ReactElement<AdminPanelData>;

        expect(element.type).toBe(AdminPanel);
        expect(element.props.viewer).toEqual({ access });
        expect(element.props.filters).toEqual({ q: 'ana', filter: 'blocked' });
        expect(element.props.pagination).toEqual({ page: 1, per_page: config.admin.usersPerPage, total: 1, pages: 1 });
        expect(element.props.users.map((row) => row.id)).toEqual([blocked.id]);
        expect(element.props.users[0]?.can).toEqual({ grant_admin: false, revoke_admin: false, block: false, unblock: true });
    });
});

describe('GET /verify-email/[token]', () => {
    interface CardProps {
        token: string;
        preview: EmailVerificationPreview;
        viewerEmail: string | null;
    }

    it('abrir a página mostra o e-mail e NÃO gasta o token — confirmar é só pelo botão (POST)', async () => {
        const { AuthLayout } = await import('@/components/layouts/auth-layout');
        const { VerifyEmailCard } = await import('@/components/verify-email/verify-email-card');
        const ana = await createUser({ name: 'Ana Souza', email: 'ana@example.com' });

        await sendEmailVerification(ana);
        const token = lastToken();

        // Dois GETs: o scanner do provedor de e-mail e, depois, a pessoa.
        await verifyEmailPage(token);
        const element = (await verifyEmailPage(token)) as ReactElement<{ title: string; children: ReactElement<CardProps> }>;

        expect(element.type).toBe(AuthLayout);
        expect(element.props.title).toBe('Confirme seu e-mail');
        expect(element.props.children.type).toBe(VerifyEmailCard);
        expect(element.props.children.props).toEqual({
            token,
            preview: { email: 'ana@example.com', name: 'Ana Souza' },
            viewerEmail: null,
        });

        expect(await db.$count(emailVerifications)).toBe(1);
        expect(await previewEmailVerification(token)).not.toBeNull();

        const [row] = await db.select({ verifiedAt: users.emailVerifiedAt }).from(users).where(eq(users.id, ana.id));

        expect(row?.verifiedAt).toBeNull();

        // Pública: não pede sessão e não abre nenhuma.
        expect(jar.store.has('taskon_session')).toBe(false);
        expect(await db.$count(sessions)).toBe(0);
    });

    it('aberta na sessão de outra pessoa, a página avisa de quem é a conta do link', async () => {
        const ana = await createUser({ email: 'ana@example.com' });
        const bia = await createUser({ email: 'bia@example.com' });

        await sendEmailVerification(ana);
        const token = lastToken();

        await signIn(bia);

        const element = (await verifyEmailPage(token)) as ReactElement<{ children: ReactElement<CardProps> }>;

        expect(element.props.children.props.viewerEmail).toBe('bia@example.com');
        expect(element.props.children.props.preview.email).toBe('ana@example.com');
    });

    it('link que não vale mais vira a tela de link indisponível — e o nativo pendente é mandado pedir outro no /admin', async () => {
        const pending = await createUser({ email: NATIVE_EMAIL });

        const anonymous = (await verifyEmailPage('x'.repeat(43))) as ReactElement<{ title: string }>;

        expect(anonymous.props.title).toBe('Link indisponível');

        await signIn(pending);

        const element = (await verifyEmailPage('x'.repeat(43))) as ReactElement<{
            title: string;
            children: ReactElement<{ children: ReactElement<{ href: string }>[] }>;
        }>;

        expect(element.props.title).toBe('Link indisponível');
        expect(element.props.children.props.children[1]?.props.href).toBe('/admin');
    });
});

describe('o proxy', () => {
    it('/admin (e o que vier abaixo) sem cookie vai para o login, com o ?next=', () => {
        for (const path of ['/admin', '/admin?filter=blocked&page=2', '/admin/qualquer']) {
            const response = proxy(new NextRequest(`http://taskon.test${path}`));
            const location = response.headers.get('location');

            expect(location, path).not.toBeNull();

            const url = new URL(location!);

            expect(url.pathname, path).toBe('/login');
            expect(url.searchParams.get('next'), path).toBe(path);
        }
    });

    it('/verify-email é pública: passa sem cookie (o token é a prova, não a sessão)', () => {
        const response = proxy(new NextRequest('http://taskon.test/verify-email/abc'));

        expect(response.headers.get('location')).toBeNull();
    });
});

describe('o menu da conta (authUserResource.admin)', () => {
    it('mostra "Administração" para nativo, nativo pendente e admin concedido — e só para eles', async () => {
        const second = 'segunda-nativa@taskon.test';

        config.admin.nativeEmails.push(second);

        try {
            const access = async (overrides: Partial<typeof users.$inferInsert>) =>
                authUserResource(await createUser(overrides)).admin;

            expect(await access({ email: NATIVE_EMAIL, emailVerifiedAt: NOW })).toBe('native');
            expect(await access({ email: second })).toBe('pending');
            expect(await access({ isAdmin: true })).toBe('admin');
            expect(await access({})).toBeNull();
            expect(await access({ isAdmin: true, blockedAt: NOW })).toBeNull();
        } finally {
            config.admin.nativeEmails.splice(config.admin.nativeEmails.indexOf(second), 1);
        }
    });
});
