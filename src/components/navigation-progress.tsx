'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useLayoutEffect, useReducer } from 'react';
import { ACTION_END_EVENT, ACTION_START_EVENT } from '@/lib/actions';

/**
 * A barrinha de progresso do topo — a que o Inertia mostrava em toda visita
 * (cor da marca, 120 ms de atraso, sem spinner). No App Router a navegação
 * espera o servidor sem nenhum sinal na tela; sem isto, clicar num quadro
 * parece não ter feito nada.
 *
 * Duas coisas a mantêm de pé, e elas podem se sobrepor:
 *
 *  - uma NAVEGAÇÃO: clique em link interno, Voltar/Avançar ou
 *    `startNavigationProgress()` antes de um `router.push` (abrir/fechar card).
 *    Termina quando a rota nova chega à tela (o pathname commitado muda);
 *  - Server Actions pendentes: o Inertia também mostrava a barra nos
 *    POST/PATCH/DELETE. O `runAction` avisa o começo e o fim de cada uma
 *    (salvo `progress: false`, o antigo `showProgress: false` do arraste).
 *
 * Só aparece se a espera passar de 120 ms: navegação rápida (cache do
 * roteador) e action rápida não piscam barra nenhuma.
 */
const START_EVENT = 'taskon:navigation-start';

/** A espera que vale uma barra — a mesma do `progress.delay` do Inertia. */
const DELAY = 120;

/** Navegação que nunca troca de rota (erro, link para a mesma página) não deixa a barra presa. */
const GIVE_UP = 10_000;

/** Se o `animationend` do fim não vier (aba em segundo plano), a barra some assim mesmo. */
const DONE_FALLBACK = 1_000;

/**
 * Controles que podem morar DENTRO de um link sem ser o link — a estrela de
 * favoritar no cartão do quadro, por exemplo. O clique neles não navega (o
 * onClick deles cancela o link), mas só fica claro depois: aqui, na captura,
 * ainda não dá para saber.
 */
const NESTED_CONTROLS =
    'button, input, select, textarea, label, [role="button"], [role="checkbox"], [role="switch"]';

/**
 * Avise antes de um `router.push` — cliques em <Link> já são detectados
 * sozinhos. Com o destino, um push para a própria página não liga a barra.
 */
export function startNavigationProgress(href?: string): void {
    window.dispatchEvent(new CustomEvent<string | undefined>(START_EVENT, { detail: href }));
}

export interface ProgressState {
    /**
     * O último pathname que chegou à TELA (o `usePathname()` commitado). É ele
     * o "de onde a navegação saiu" — não o `window.location`: no
     * Voltar/Avançar o navegador troca a URL antes de o 'popstate' disparar,
     * e a navegação começaria já "no destino", sem nunca ver a troca.
     */
    committed: string;
    /** Navegação em curso; termina quando `committed` deixar de ser `from`. */
    navigation: { id: number; from: string } | null;
    /** Server Actions sem resposta que pediram a barra. */
    actions: number;
    /** A espera passou de 120 ms: a barra está na tela. */
    visible: boolean;
    /** Numera as navegações, para o "desisto" de uma não matar a seguinte. */
    sequence: number;
}

export type ProgressEvent =
    /** `to`: o pathname de destino, quando se sabe. */
    | { type: 'navigate'; to?: string }
    | { type: 'commit'; pathname: string }
    | { type: 'action-start' }
    | { type: 'action-end' }
    /** Os 120 ms passaram. */
    | { type: 'reveal' }
    | { type: 'give-up'; id: number }
    /** A animação de conclusão acabou. */
    | { type: 'hidden' };

export function initialProgress(pathname: string): ProgressState {
    return { committed: pathname, navigation: null, actions: 0, visible: false, sequence: 0 };
}

/** Ainda há o que esperar: uma rota que não chegou ou uma action sem resposta. */
export function isBusy(state: ProgressState): boolean {
    return state.navigation?.from === state.committed || state.actions > 0;
}

/**
 * As transições da barra, puras (testadas em tests/regressions/navigation.test.ts).
 * Toda decisão compara com o MESMO valor — o pathname commitado —, inclusive a
 * dos 120 ms: o timer pode vencer entre o commit da rota nova e o cleanup do
 * effect, e aí a navegação já acabou e a barra não deve aparecer.
 */
export function progressReducer(state: ProgressState, event: ProgressEvent): ProgressState {
    switch (event.type) {
        case 'navigate': {
            // Mesmo pathname (âncora, só a query, Voltar de um #hash): não há
            // rota nova a esperar, e a barra ficaria presa até desistir.
            if (event.to !== undefined && event.to === state.committed) return state;

            const id = state.sequence + 1;

            return { ...state, sequence: id, navigation: { id, from: state.committed } };
        }

        case 'commit':
            if (event.pathname === state.committed) return state;

            // A rota nova chegou: a navegação em curso saiu de um pathname que
            // não está mais na tela, logo terminou.
            return { ...state, committed: event.pathname, navigation: null };

        case 'action-start':
            return { ...state, actions: state.actions + 1 };

        case 'action-end':
            // Nunca negativo: um fim sem começo não pode prender a conta.
            return state.actions > 0 ? { ...state, actions: state.actions - 1 } : state;

        case 'reveal':
            return !state.visible && isBusy(state) ? { ...state, visible: true } : state;

        case 'give-up':
            return state.navigation?.id === event.id ? { ...state, navigation: null } : state;

        case 'hidden':
            // Se algo recomeçou durante a conclusão, a barra continua (crescendo de novo).
            return state.visible && !isBusy(state) ? { ...state, visible: false } : state;
    }
}

/** O clique caiu num controle aninhado dentro do link, e não no link em si. */
function isNestedControl(target: Element, anchor: HTMLAnchorElement): boolean {
    const control = target.closest(NESTED_CONTROLS);

    return control !== null && control !== anchor && anchor.contains(control);
}

export function NavigationProgress() {
    const pathname = usePathname();
    const [state, dispatch] = useReducer(progressReducer, pathname, initialProgress);
    const busy = isBusy(state);
    const navigationId = state.navigation?.id;

    // Layout effect: o pathname commitado fica registrado no mesmo commit em
    // que a rota nova entra, antes de qualquer timer poder vencer.
    useLayoutEffect(() => dispatch({ type: 'commit', pathname }), [pathname]);

    useEffect(() => {
        if (!busy || state.visible) return;

        const timer = setTimeout(() => dispatch({ type: 'reveal' }), DELAY);

        return () => clearTimeout(timer);
    }, [busy, state.visible]);

    useEffect(() => {
        if (navigationId === undefined) return;

        const timer = setTimeout(() => dispatch({ type: 'give-up', id: navigationId }), GIVE_UP);

        return () => clearTimeout(timer);
    }, [navigationId]);

    useEffect(() => {
        if (busy || !state.visible) return;

        const timer = setTimeout(() => dispatch({ type: 'hidden' }), DONE_FALLBACK);

        return () => clearTimeout(timer);
    }, [busy, state.visible]);

    useEffect(() => {
        const onClick = (event: MouseEvent) => {
            if (event.defaultPrevented || event.button !== 0) return;
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            if (!(event.target instanceof Element)) return;

            const anchor = event.target.closest('a[href]');

            if (!(anchor instanceof HTMLAnchorElement)) return;
            if ((anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return;
            if (isNestedControl(event.target, anchor)) return;

            const url = new URL(anchor.href, window.location.href);

            // Outro site: a página inteira troca, nada a esperar aqui.
            if (url.origin !== window.location.origin) return;

            dispatch({ type: 'navigate', to: url.pathname });
        };

        // Aqui a URL JÁ é a do destino; a origem vem do pathname commitado.
        const onPopState = () => dispatch({ type: 'navigate', to: window.location.pathname });

        const onStart = (event: Event) => {
            const href = event instanceof CustomEvent && typeof event.detail === 'string' ? event.detail : undefined;

            dispatch({
                type: 'navigate',
                to: href === undefined ? undefined : new URL(href, window.location.href).pathname,
            });
        };

        const onActionStart = () => dispatch({ type: 'action-start' });
        const onActionEnd = () => dispatch({ type: 'action-end' });

        // Captura: roda antes do onClick do <Link>, que cancela o evento.
        document.addEventListener('click', onClick, true);
        window.addEventListener('popstate', onPopState);
        window.addEventListener(START_EVENT, onStart);
        window.addEventListener(ACTION_START_EVENT, onActionStart);
        window.addEventListener(ACTION_END_EVENT, onActionEnd);

        return () => {
            document.removeEventListener('click', onClick, true);
            window.removeEventListener('popstate', onPopState);
            window.removeEventListener(START_EVENT, onStart);
            window.removeEventListener(ACTION_START_EVENT, onActionStart);
            window.removeEventListener(ACTION_END_EVENT, onActionEnd);
        };
    }, []);

    // Ainda dentro dos 120 ms, ou terminou antes de aparecer: nada na tela.
    if (!state.visible) return null;

    return (
        <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-60 h-0.5">
            <div
                key={busy ? 'grow' : 'done'}
                className={busy ? 'nav-progress-grow' : 'nav-progress-done'}
                onAnimationEnd={busy ? undefined : () => dispatch({ type: 'hidden' })}
            />
        </div>
    );
}
