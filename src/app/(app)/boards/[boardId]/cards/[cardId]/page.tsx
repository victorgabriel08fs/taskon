import { notFound } from 'next/navigation';
import { ActiveCardBridge } from '@/components/board/active-card';
import { parseRouteId } from '@/lib/route-id';
import { requireUser } from '@/server/auth/session';
import { HttpError } from '@/server/errors';
import { loadCardDetail } from '@/server/queries/card';
import type { CardDetail } from '@/types';

interface Params {
    params: Promise<{ boardId: string; cardId: string }>;
}

/**
 * Deep link do card: `/boards/1/cards/42`. O quadro já está na tela (é o
 * layout); esta página só carrega o card e o entrega ao quadro pela ponte.
 * Um card arquivado também abre — F5 numa aba velha, um link colado no chat —
 * e o modal avisa que ele está fora das colunas.
 */
export default async function CardPage({ params }: Params) {
    const user = await requireUser();
    const { boardId, cardId } = await params;

    // A página roda junto com o layout, não depois dele: o id do quadro também
    // é conferido aqui. Acima do teto do `integer`, a consulta quebraria no
    // banco (500) em vez de responder 404.
    const board = parseRouteId(boardId);
    const card = parseRouteId(cardId);

    if (board === null || card === null) notFound();

    let detail: CardDetail;

    try {
        detail = await loadCardDetail(user, board, card);
    } catch (error) {
        // Card de outro quadro, excluído ou inexistente.
        if (error instanceof HttpError && error.status === 404) notFound();

        // Sem acesso ao quadro: quem mostra o 403 é o layout, que nem chega a
        // renderizar esta página.
        if (error instanceof HttpError && error.status === 403) return null;

        throw error;
    }

    return <ActiveCardBridge card={detail} />;
}
