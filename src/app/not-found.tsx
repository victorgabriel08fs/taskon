import { SearchX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { currentUser } from '@/server/auth/session';

export const metadata: Metadata = {
    title: 'Página não encontrada',
};

/**
 * O 404: endereço que não existe, ou `notFound()` de uma página (quadro ou
 * card excluído, id inválido). Mesmo desenho da tela de 403, com o caminho
 * de volta certo para quem está ou não logado.
 */
export default async function NotFound() {
    const user = await currentUser();

    return (
        <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6 text-center">
            <span className="grid size-14 place-items-center rounded-2xl bg-primary-soft text-primary">
                <SearchX className="size-7" />
            </span>
            <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-fg">Erro 404</p>
                <h1 className="text-xl font-semibold">Página não encontrada</h1>
                <p className="max-w-sm text-sm text-muted-fg">
                    O endereço não existe ou o que estava aqui foi excluído.
                </p>
            </div>
            <Link
                href={user ? '/dashboard' : '/'}
                className="text-sm font-semibold text-primary underline-offset-4 hover:underline"
            >
                {user ? 'Voltar para o painel' : 'Voltar para o início'}
            </Link>
        </div>
    );
}
