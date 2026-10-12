import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { login, resetPassword } from '@/server/actions/auth';
import { currentSession, requireUser, safeRedirectPath } from '@/server/auth/session';
import { FLASH_COOKIE, STATUS_COOKIE, flashedStatus } from '@/server/flash';
import { sentMail } from '@/server/mail/mailer';
import { sendPasswordResetLink } from '@/server/services/auth';
import { createUser } from '../support/factories';

/**
 * Regressões do redirecionamento depois da autenticação:
 *
 *  1. o `?next=` do login era um redirecionamento aberto — o filtro olhava só
 *     o começo do texto ("/" e não "//"), mas o navegador APAGA TAB/CR/LF da
 *     URL antes de segui-la, e "/\t/evil.com" vira "//evil.com";
 *  2. depois de redefinir a senha, o login voltou a mostrar a caixa verde de
 *     status (o `->with('status')` do Laravel), e não só um toast passageiro.
 *
 * Como em tests/parity/auth.test.ts, só o `next/headers` é dublê: um pote de
 * cookies em memória (que também guarda as opções de cada cookie) e os
 * cabeçalhos da requisição. Sessão, flash e banco são os de verdade.
 */
const request = vi.hoisted(() => {
    const store = new Map<string, string>();
    const options = new Map<string, unknown>();
    const headers = new Map<string, string>();

    return {
        store,
        options,
        headers,
        jar: {
            get: (name: string) => (store.has(name) ? { name, value: store.get(name)! } : undefined),
            has: (name: string) => store.has(name),
            set: (name: string, value: string, cookieOptions?: unknown) => {
                store.set(name, value);
                options.set(name, cookieOptions);
            },
            delete: (name: string) => {
                store.delete(name);
            },
            getAll: () => [...store].map(([name, value]) => ({ name, value })),
        },
    };
});

vi.mock('next/headers', () => ({
    cookies: async () => request.jar,
    headers: async () =>
        new Headers({
            'x-forwarded-for': '203.0.113.9',
            'user-agent': 'vitest',
            ...Object.fromEntries(request.headers),
        }),
}));
vi.mock('next/cache', () => ({ refresh: vi.fn() }));

const IP = '203.0.113.9';

const RESET_STATUS = 'Sua senha foi redefinida. Entre com a nova senha.';

/** Para onde a chamada redirecionou (o `assertRedirect`), ou null. */
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

/** O token cru só existe no e-mail — como no teste de verdade, ele sai de lá. */
function tokenFromMail(): string {
    const match = /\/reset-password\/([A-Za-z0-9_-]+)\?email=/.exec(sentMail.at(-1)?.text ?? '');

    expect(match, 'o e-mail deveria trazer o link de redefinição').not.toBeNull();

    return match![1]!;
}

beforeEach(() => {
    request.store.clear();
    request.options.clear();
    request.headers.clear();
});

/** O que um atacante põe no `?next=` — nenhum destes pode sair do site. */
const HOSTILE: [label: string, path: string][] = [
    ['TAB depois da barra', '/\t/evil.com'],
    ['LF depois da barra', '/\n/evil.com'],
    ['CR depois da barra', '/\r/evil.com'],
    ['protocolo relativo', '//evil.com'],
    ['barra invertida depois da barra', '/\\evil.com'],
    ['barra invertida no meio', '/x\\y'],
    ['URL absoluta', 'https://evil.com'],
    ['esquema javascript:', 'javascript:alert(1)'],
    ['texto vazio', ''],
    ['NUL', '/\u0000/evil.com'],
    ['ESC', '/boards\u001b'],
    ['DEL', '/boards\u007f'],
    ['TAB no fim', '/boards/1\t'],
    ['sem barra no começo', 'boards/1'],
    ['espaço antes da barra', ' /boards/1'],
    ['"." que normaliza para "//"', '/.//evil.com'],
    ['"%2e" que normaliza para "//"', '/%2e//evil.com'],
    ['".." que normaliza para "//"', '/a/..//evil.com'],
];

describe('safeRedirectPath', () => {
    it('a premissa: o navegador limpa a URL antes de segui-la, e o filtro antigo deixava passar', () => {
        // TAB/CR/LF somem e "\" vale "/": todos estes caem em OUTRO domínio
        // quando resolvidos a partir de uma página do app.
        for (const path of ['/\t/evil.com', '/\n/evil.com', '/\r/evil.com', '/\\evil.com']) {
            expect(new URL(path, 'https://taskon.app/login').host, JSON.stringify(path)).toBe('evil.com');
        }

        // E o "." só some na normalização: o caminho normalizado vira "//evil.com".
        expect(new URL('/.//evil.com', 'http://taskon.invalid').pathname).toBe('//evil.com');
    });

    it.each(HOSTILE)('recusa %s', (_label, path) => {
        expect(safeRedirectPath(path)).toBeNull();
    });

    it('recusa null e undefined', () => {
        expect(safeRedirectPath(null)).toBeNull();
        expect(safeRedirectPath(undefined)).toBeNull();
    });

    it.each([
        ['/dashboard', '/dashboard'],
        ['/', '/'],
        ['/boards/1?x=1#y', '/boards/1?x=1#y'],
        ['/boards/1/cards/42', '/boards/1/cards/42'],
        ['/settings/profile?aba=senha#form', '/settings/profile?aba=senha#form'],
        // Codificado é texto, não separador: o navegador não decodifica nem apaga.
        ['/boards?q=%2F%2Fevil.com', '/boards?q=%2F%2Fevil.com'],
        ['/%2F/evil.com', '/%2F/evil.com'],
        ['/%09/evil.com', '/%09/evil.com'],
        ['/%5Cevil.com', '/%5Cevil.com'],
        ['/boards/a%20b', '/boards/a%20b'],
        // Sai a forma normalizada — a mesma que o navegador seguiria.
        ['/a/../boards/1', '/boards/1'],
        ['/boards/./1', '/boards/1'],
        ['/boards/ção', '/boards/%C3%A7%C3%A3o'],
        ['/boards/1#', '/boards/1'],
    ])('aceita %j → %j', (path, expected) => {
        expect(safeRedirectPath(path)).toBe(expected);
    });

    it('o caminho normalizado passa de novo sem mudar (a action reconfere o que a página mandou)', () => {
        for (const path of ['/boards/1?x=1#y', '/a/../boards/1', '/boards/ção', '/%2F/evil.com']) {
            const once = safeRedirectPath(path);

            expect(once).not.toBeNull();
            expect(safeRedirectPath(once)).toBe(once);
        }
    });
});

describe('login com ?next= (ponta a ponta, na Server Action)', () => {
    it('next="/\\t/evil.com" entra e vai para o painel, não para outro domínio', async () => {
        const user = await createUser();

        const target = await redirectOf(
            login({ email: user.email, password: 'password', remember: false, next: '/\t/evil.com' }),
        );

        expect(target).toBe('/dashboard');
        expect((await currentSession())?.user.id).toBe(user.id);
    });

    // Uma amostra de cada família (cada login custa um bcrypt); a lista inteira
    // já passou pelo filtro nos testes acima.
    const sample = ['/\n/evil.com', '/\r/evil.com', '//evil.com', '/\\evil.com', 'https://evil.com', '/.//evil.com'];

    it.each(HOSTILE.filter(([, path]) => sample.includes(path)))('%s → painel', async (_label, next) => {
        const user = await createUser();

        expect(await redirectOf(login({ email: user.email, password: 'password', remember: false, next }))).toBe(
            '/dashboard',
        );
    });

    it('caminho interno continua valendo — já normalizado', async () => {
        const user = await createUser();

        expect(
            await redirectOf(login({ email: user.email, password: 'password', remember: false, next: '/boards/1?x=1#y' })),
        ).toBe('/boards/1?x=1#y');

        request.store.clear();

        expect(
            await redirectOf(login({ email: user.email, password: 'password', remember: false, next: '/a/../boards/1' })),
        ).toBe('/boards/1');
    });

    it('a página de login já descarta o next hostil antes de entregá-lo ao formulário', async () => {
        const { default: LoginPage } = await import('@/app/(guest)/login/page');

        const page = (await LoginPage({ searchParams: Promise.resolve({ next: '/\t/evil.com' }) })) as ReactElement<{
            children: ReactElement<{ next: string | null }>;
        }>;

        expect(page.props.children.props.next).toBeNull();

        const valid = (await LoginPage({ searchParams: Promise.resolve({ next: '/a/../boards/1' }) })) as ReactElement<{
            children: ReactElement<{ next: string | null }>;
        }>;

        expect(valid.props.children.props.next).toBe('/boards/1');
    });

    it('o requireUser anota no ?next= só o caminho interno, normalizado', async () => {
        request.headers.set('x-taskon-path', '/a/../boards/1?x=1');

        expect(await redirectOf(requireUser())).toBe(`/login?next=${encodeURIComponent('/boards/1?x=1')}`);

        request.headers.set('x-taskon-path', '/.//evil.com');

        expect(await redirectOf(requireUser())).toBe('/login');
    });
});

describe('redefinir a senha → caixa de status no login', () => {
    it('grava o status num cookie curto (e não um toast) e manda para o login', async () => {
        const user = await createUser();

        await sendPasswordResetLink(user.email, IP);

        const target = await redirectOf(
            resetPassword({
                token: tokenFromMail(),
                email: user.email,
                password: 'nova-senha-123',
                password_confirmation: 'nova-senha-123',
            }),
        );

        expect(target).toBe('/login');
        expect(request.store.get(STATUS_COOKIE)).toBe(JSON.stringify(RESET_STATUS));
        expect(request.options.get(STATUS_COOKIE)).toEqual({
            path: '/',
            maxAge: 60,
            sameSite: 'lax',
            secure: false,
            httpOnly: false,
        });
        expect(request.store.has(FLASH_COOKIE)).toBe(false);
        expect(await flashedStatus()).toBe(RESET_STATUS);
    });

    it('a página de login entrega o status ao formulário; sem o cookie, nada', async () => {
        const { default: LoginPage } = await import('@/app/(guest)/login/page');
        const { LoginForm } = await import('@/components/auth/login-form');

        request.jar.set(STATUS_COOKIE, JSON.stringify(RESET_STATUS));

        const withStatus = (await LoginPage({ searchParams: Promise.resolve({}) })) as ReactElement<{
            children: ReactElement<{ next: string | null; status: string | null }>;
        }>;

        expect(withStatus.props.children.type).toBe(LoginForm);
        expect(withStatus.props.children.props).toEqual({ next: null, status: RESET_STATUS });

        request.store.clear();

        const without = (await LoginPage({ searchParams: Promise.resolve({}) })) as ReactElement<{
            children: ReactElement<{ status: string | null }>;
        }>;

        expect(without.props.children.props.status).toBeNull();
    });

    it.each([
        ['texto que não é JSON', 'Sua senha foi redefinida'],
        ['JSON que não é texto', JSON.stringify({ type: 'success', message: 'x' })],
        ['texto vazio', JSON.stringify('')],
        ['só espaços', JSON.stringify('   ')],
        ['texto longo demais', JSON.stringify('x'.repeat(201))],
    ])('ignora status fora do formato: %s', async (_label, raw) => {
        request.jar.set(STATUS_COOKIE, raw);

        expect(await flashedStatus()).toBeNull();
    });

    it('o formulário mostra a caixa verde do legado (mesmas classes), e só quando há status', async () => {
        const { LoginForm } = await import('@/components/auth/login-form');

        const html = renderToStaticMarkup(createElement(LoginForm, { next: null, status: RESET_STATUS }));

        expect(html).toContain(
            `<div role="status" class="mb-5 animate-pop rounded-lg bg-success/12 px-3.5 py-2.5 text-sm font-medium text-success">${RESET_STATUS}</div>`,
        );

        // A caixa vem antes do formulário, como no legado.
        expect(html.indexOf(RESET_STATUS)).toBeLessThan(html.indexOf('<form'));

        expect(renderToStaticMarkup(createElement(LoginForm, { next: null, status: null }))).not.toContain('role="status"');
    });
});
