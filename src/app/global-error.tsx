'use client';

import { RotateCcw, TriangleAlert } from 'lucide-react';
import { useEffect, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import './globals.css';

/**
 * A última rede: o próprio layout raiz falhou (ex.: o banco caiu na leitura
 * da sessão). Esta tela SUBSTITUI o layout — traz o próprio <html>, o CSS e o
 * tema, e não pode contar com sessão, Providers nem banco.
 */

const noop = () => () => {};

/** O tema salvo neste navegador (use-appearance.ts), resolvido sem o cookie do SSR. */
function prefersDark(): boolean {
    let appearance: string | null = null;

    try {
        appearance = window.localStorage.getItem('appearance');
    } catch {
        // Storage bloqueado: segue o sistema.
    }

    return appearance === 'dark' || (appearance !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
    const dark = useSyncExternalStore(noop, prefersDark, () => false);

    useEffect(() => {
        console.error(error);
    }, [error]);

    return (
        <html lang="pt-BR" className={dark ? 'dark' : undefined} suppressHydrationWarning>
            <body className="font-sans antialiased">
                <title>Algo deu errado · Taskon</title>

                <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6 text-center">
                    <span className="grid size-14 place-items-center rounded-2xl bg-danger/12 text-danger">
                        <TriangleAlert className="size-7" />
                    </span>
                    <div className="space-y-1">
                        <h1 className="text-xl font-semibold">O Taskon não abriu</h1>
                        <p className="max-w-sm text-sm text-muted-fg">
                            Algo deu errado do nosso lado. Tente de novo em instantes.
                        </p>
                        {error.digest && (
                            <p className="pt-1 font-mono text-xs text-muted-fg/80">Código: {error.digest}</p>
                        )}
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-4">
                        <Button onClick={() => retry()}>
                            <RotateCcw className="size-4" />
                            Tentar de novo
                        </Button>
                        {/* Navegação completa de propósito (e não <Link>): depois de
                            uma falha no layout raiz, recarregar tudo — inclusive o
                            estado que mora em módulos do cliente — é o caminho seguro. */}
                        {/* oxlint-disable-next-line nextjs/no-html-link-for-pages */}
                        <a href="/" className="text-sm font-semibold text-primary underline-offset-4 hover:underline">
                            Voltar para o início
                        </a>
                    </div>
                </div>
            </body>
        </html>
    );
}
