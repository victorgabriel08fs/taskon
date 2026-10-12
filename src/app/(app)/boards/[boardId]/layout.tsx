import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { BoardShow } from '@/components/board/board-show';
import { Forbidden } from '@/components/forbidden';
import { currentUser, requireUser } from '@/server/auth/session';
import { HttpError } from '@/server/errors';
import { loadBoardActivity, loadBoardPage, loadBoardTitle, type BoardPageData } from '@/server/queries/board';

interface Params {
    params: Promise<{ boardId: string }>;
}

/** O id da URL, ou null se não for um inteiro positivo ("abc", "1.5", "0x10" viram 404). */
function routeId(value: string): number | null {
    if (!/^\d+$/.test(value)) return null;

    const id = Number(value);

    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
    const id = routeId((await params).boardId);
    const user = await currentUser();

    if (id === null || !user) return {};

    // Sem acesso, o título fica o padrão: a tela de 403 não pode vazar o nome
    // do quadro pela aba do navegador. O 404/403 em si é decidido pelo layout.
    const title = await loadBoardTitle(user, id).catch((error: unknown) => {
        if (error instanceof HttpError) return null;

        throw error;
    });

    return title ? { title } : {};
}

/**
 * O quadro mora no layout, e não na página: o App Router não remonta layouts
 * ao navegar entre `/boards/1` e `/boards/1/cards/42`, então abrir e fechar um
 * card preserva filtros, seleção e scroll (o `preserveState` do Inertia). A
 * página do card só entrega o `CardDetail` ao quadro — ver
 * src/components/board/active-card.tsx.
 */
export default async function BoardLayout({ children, params }: Params & { children: ReactNode }) {
    const user = await requireUser();
    const id = routeId((await params).boardId);

    if (id === null) notFound();

    let data: BoardPageData;

    try {
        data = await loadBoardPage(user, id);
    } catch (error) {
        if (error instanceof HttpError && error.status === 404) notFound();
        if (error instanceof HttpError && error.status === 403) return <Forbidden />;

        throw error;
    }

    // Sem await: é o `Inertia::defer` — o quadro pinta primeiro e o histórico
    // chega depois, na mesma resposta. A consulta só começa depois da
    // autorização acima, então nunca roda para quem não pode ver o quadro.
    const activity = loadBoardActivity(user, id);

    return (
        <BoardShow
            board={data.board}
            backgrounds={data.backgrounds}
            colors={data.colors}
            autoArchive={data.autoArchive}
            activity={activity}
        >
            {children}
        </BoardShow>
    );
}
