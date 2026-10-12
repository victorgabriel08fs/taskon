import { ShieldAlert } from 'lucide-react';
import Link from 'next/link';

/**
 * A tela do 403. O Laravel respondia "This action is unauthorized." numa página
 * de erro; aqui a página explica e oferece o caminho de volta.
 */
export function Forbidden({ message = 'Você não participa deste quadro.' }: { message?: string }) {
    return (
        <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6 text-center">
            <span className="grid size-14 place-items-center rounded-2xl bg-danger/12 text-danger">
                <ShieldAlert className="size-7" />
            </span>
            <div className="space-y-1">
                <h1 className="text-xl font-semibold">Sem permissão</h1>
                <p className="max-w-sm text-sm text-muted-fg">{message} Peça a quem administra o quadro para adicionar você.</p>
            </div>
            <Link href="/boards" className="text-sm font-semibold text-primary underline-offset-4 hover:underline">
                Voltar para os meus quadros
            </Link>
        </div>
    );
}
