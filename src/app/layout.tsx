import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { Providers } from '@/components/providers';
import { cn } from '@/lib/utils';
import { currentUser } from '@/server/auth/session';
import { config } from '@/server/config';
import { authUserResource } from '@/server/resources/common';
import type { Appearance } from '@/types';
import './globals.css';

// Geist na interface e Geist Mono nos números que se comparam (§4 da marca).
const geist = Geist({
    subsets: ['latin', 'latin-ext'],
    variable: '--font-geist',
    display: 'swap',
});

const geistMono = Geist_Mono({
    subsets: ['latin', 'latin-ext'],
    variable: '--font-geist-mono',
    display: 'swap',
});

export const metadata: Metadata = {
    title: { default: config.appName, template: `%s · ${config.appName}` },
    description: 'Quadros, listas e cards para organizar o trabalho do time.',
    icons: {
        icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }, { url: '/favicon.ico', sizes: '48x48' }],
        apple: '/apple-touch-icon.png',
    },
};

export const viewport: Viewport = {
    themeColor: [
        { media: '(prefers-color-scheme: light)', color: '#f4f5f0' },
        { media: '(prefers-color-scheme: dark)', color: '#15191c' },
    ],
};

const APPEARANCES: Appearance[] = ['light', 'dark', 'system'];

/**
 * Aplica o tema antes do primeiro paint, a partir do cookie `appearance`
 * (escrito por use-appearance.ts) — o "sistema" se resolve aqui mesmo, pelo
 * prefers-color-scheme do navegador.
 *
 * A classe `dark` do <html> é SÓ deste script e do `apply()` do cliente; o
 * React não renderiza `className` no <html>. Se renderizasse, cada refresh()
 * de Server Action re-renderizaria a raiz e reescreveria o atributo `class`
 * com o valor que o servidor conhece — apagando o `dark` que veio do sistema
 * (tema "Sistema" com o SO escuro ficava claro depois de qualquer ação).
 */
function themeScript(appearance: Appearance): string {
    return `(function(){try{var a=${JSON.stringify(appearance)};document.documentElement.classList.toggle('dark',a==='dark'||(a==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches))}catch(e){}})();`;
}

export default async function RootLayout({ children }: { children: ReactNode }) {
    const stored = (await cookies()).get('appearance')?.value as Appearance | undefined;
    const appearance: Appearance = stored && APPEARANCES.includes(stored) ? stored : 'system';
    const user = await currentUser();

    return (
        // Sem className no <html> de propósito (ver themeScript). O
        // suppressHydrationWarning cobre a classe que o script põe antes da
        // hidratação.
        <html lang="pt-BR" suppressHydrationWarning>
            <head>
                <script dangerouslySetInnerHTML={{ __html: themeScript(appearance) }} />
                <style>{`html{background-color:#f4f5f0}html.dark{background-color:#15191c}`}</style>
            </head>
            {/* As variáveis das fontes moram no <body> pelo mesmo motivo.
                Funciona porque `font-sans`/`font-mono` estão num `@theme
                inline`: o utilitário carrega `var(--font-geist)` cru e o
                resolve no próprio elemento, não no :root. */}
            <body className={cn(geist.variable, geistMono.variable, 'font-sans antialiased')}>
                <Providers user={user ? authUserResource(user) : null}>{children}</Providers>
            </body>
        </html>
    );
}
