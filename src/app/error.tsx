'use client';

import { RotateCcw, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';
import { useCurrentUser } from '@/components/providers';
import { Button } from '@/components/ui/button';

/**
 * Falha inesperada ao renderizar uma página (banco fora do ar, bug). O layout
 * raiz continua de pé, então tema e sessão seguem valendo aqui.
 *
 * Em produção o Next não manda a mensagem do erro do servidor ao navegador —
 * só o `digest`, que é o que liga esta tela à linha do log na Vercel.
 */
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
    const user = useCurrentUser();

    useEffect(() => {
        console.error(error);
    }, [error]);

    return (
        <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6 text-center">
            <span className="grid size-14 place-items-center rounded-2xl bg-danger/12 text-danger">
                <TriangleAlert className="size-7" />
            </span>
            <div className="space-y-1">
                <h1 className="text-xl font-semibold">Algo deu errado</h1>
                <p className="max-w-sm text-sm text-muted-fg">
                    Não conseguimos carregar esta tela agora. Tente de novo em instantes.
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
                <Link
                    href={user ? '/dashboard' : '/'}
                    className="text-sm font-semibold text-primary underline-offset-4 hover:underline"
                >
                    {user ? 'Voltar para o painel' : 'Voltar para o início'}
                </Link>
            </div>
        </div>
    );
}
