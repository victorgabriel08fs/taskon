import { NextResponse, type NextRequest } from 'next/server';

/**
 * Checagem OTIMISTA de sessão — só olha se o cookie existe, sem ir ao banco.
 * A verificação de verdade acontece em cada página (`requireUser`) e em cada
 * Server Action (`defineAction`). O proxy só economiza a renderização de uma
 * página protegida para quem claramente não tem sessão, e anota o caminho
 * pedido para o login devolver a pessoa ao lugar certo.
 *
 * O nome do cookie é o de src/server/auth/session.ts (SESSION_COOKIE). Não
 * importamos de lá para o proxy não arrastar o banco junto.
 */
const SESSION_COOKIE = 'taskon_session';

const PROTECTED = ['/dashboard', '/boards', '/settings', '/admin'];

const isProtected = (pathname: string) =>
    PROTECTED.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

export function proxy(request: NextRequest) {
    const { pathname, search } = request.nextUrl;

    // Server Actions são POST para a própria página: redirecioná-las quebraria
    // o protocolo. Sem sessão, a action responde 401 sozinha.
    const isNavigation = request.method === 'GET' || request.method === 'HEAD';

    if (isNavigation && isProtected(pathname) && !request.cookies.has(SESSION_COOKIE)) {
        const url = request.nextUrl.clone();

        url.pathname = '/login';
        url.search = `?next=${encodeURIComponent(pathname + search)}`;

        return NextResponse.redirect(url);
    }

    const headers = new Headers(request.headers);

    headers.set('x-taskon-path', pathname + search);

    return NextResponse.next({ request: { headers } });
}

export const config = {
    matcher: ['/((?!api/|_next/static|_next/image|favicon\\.ico|favicon\\.svg|robots\\.txt|up$).*)'],
};
