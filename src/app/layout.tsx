import type { Metadata, Viewport } from 'next';
import { Instrument_Sans } from 'next/font/google';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { Providers } from '@/components/providers';
import { cn } from '@/lib/utils';
import { currentUser } from '@/server/auth/session';
import { config } from '@/server/config';
import { authUserResource } from '@/server/resources/common';
import type { Appearance } from '@/types';
import './globals.css';

const instrumentSans = Instrument_Sans({
    subsets: ['latin'],
    weight: ['400', '500', '600', '700'],
    variable: '--font-instrument-sans',
    display: 'swap',
});

export const metadata: Metadata = {
    title: { default: config.appName, template: `%s · ${config.appName}` },
    description: 'Quadros, listas e cards para organizar o trabalho do time.',
    icons: { icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }, { url: '/favicon.ico' }] },
};

export const viewport: Viewport = {
    themeColor: [
        { media: '(prefers-color-scheme: light)', color: '#f8f8fb' },
        { media: '(prefers-color-scheme: dark)', color: '#141826' },
    ],
};

const APPEARANCES: Appearance[] = ['light', 'dark', 'system'];

/**
 * Aplica o tema antes do primeiro paint. O cookie `appearance` (escrito por
 * use-appearance.ts) já decide claro/escuro no SSR; só o "sistema" depende do
 * navegador, e é isso que o script resolve antes de pintar.
 */
function themeScript(appearance: Appearance): string {
    return `(function(){try{if(${JSON.stringify(appearance)}==='system'){document.documentElement.classList.toggle('dark',window.matchMedia('(prefers-color-scheme: dark)').matches)}}catch(e){}})();`;
}

export default async function RootLayout({ children }: { children: ReactNode }) {
    const stored = (await cookies()).get('appearance')?.value as Appearance | undefined;
    const appearance: Appearance = stored && APPEARANCES.includes(stored) ? stored : 'system';
    const user = await currentUser();

    return (
        <html
            lang="pt-BR"
            className={cn(instrumentSans.variable, appearance === 'dark' && 'dark')}
            suppressHydrationWarning
        >
            <head>
                <script dangerouslySetInnerHTML={{ __html: themeScript(appearance) }} />
                <style>{`html{background-color:oklch(98.5% 0.004 285)}html.dark{background-color:oklch(16% 0.02 265)}`}</style>
            </head>
            <body className="font-sans antialiased">
                <Providers user={user ? authUserResource(user) : null}>{children}</Providers>
            </body>
        </html>
    );
}
