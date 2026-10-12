'use client';

import { createContext, use, useEffect } from 'react';
import type { CardDetail } from '@/types';

/**
 * O deep link do card (`/boards/1/cards/42`) em duas metades.
 *
 * O quadro mora no `layout.tsx` de `/boards/[boardId]`, que o App Router NÃO
 * remonta ao navegar entre `/boards/1` e `/boards/1/cards/42` — filtros,
 * seleção e scroll sobrevivem, como no `preserveState` do Inertia. A página
 * do card só carrega o `CardDetail` e o entrega ao quadro por este contexto;
 * o modal em si fica no `BoardShow`, sempre montado, para a saída animar.
 *
 * Consequências de graça, como antes: F5 reabre o card, Voltar fecha, o link
 * é compartilhável — e toda action com o modal aberto re-renderiza layout e
 * página na mesma resposta, então o card aberto nunca fica desatualizado.
 */
export const ActiveCardContext = createContext<((card: CardDetail | null) => void) | null>(null);

/**
 * A ponte: renderizada pela página do card, publica o card no quadro e o
 * retira ao desmontar (navegar de volta para `/boards/1`, Voltar, excluir o
 * card). Não desenha nada.
 */
export function ActiveCardBridge({ card }: { card: CardDetail | null }) {
    const setActiveCard = use(ActiveCardContext);

    useEffect(() => {
        if (!setActiveCard) return;

        setActiveCard(card);

        return () => setActiveCard(null);
    }, [card, setActiveCard]);

    return null;
}
