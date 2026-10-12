'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * A barrinha de progresso do topo — a que o Inertia mostrava em toda visita
 * (cor da marca, 120 ms de atraso, sem spinner). No App Router a navegação
 * espera o servidor sem nenhum sinal na tela; sem isto, clicar num quadro
 * parece não ter feito nada.
 *
 * Começa num clique em link interno, no Voltar/Avançar e quando alguém chama
 * `startNavigationProgress()` antes de um `router.push` (abrir/fechar card).
 * Termina quando o pathname muda. Só aparece se a espera passar de 120 ms:
 * navegação rápida não pisca barra nenhuma.
 */
const START_EVENT = 'taskon:navigation-start';

/** Avise antes de um `router.push` — cliques em <Link> já são detectados sozinhos. */
export function startNavigationProgress(): void {
    window.dispatchEvent(new Event(START_EVENT));
}

interface Run {
    id: number;
    /** Pathname de onde a navegação saiu; quando o atual for outro, ela terminou. */
    from: string;
    visible: boolean;
}

let sequence = 0;

export function NavigationProgress() {
    const pathname = usePathname();
    const [run, setRun] = useState<Run | null>(null);

    useEffect(() => {
        let delay: ReturnType<typeof setTimeout> | undefined;
        let giveUp: ReturnType<typeof setTimeout> | undefined;

        const begin = () => {
            const id = ++sequence;

            clearTimeout(delay);
            clearTimeout(giveUp);
            setRun({ id, from: window.location.pathname, visible: false });

            // O App Router só troca a URL quando a rota nova chega: se ela já
            // mudou aos 120 ms, a navegação foi rápida e a barra nem aparece.
            delay = setTimeout(
                () =>
                    setRun((current) => {
                        if (current?.id !== id) return current;

                        return window.location.pathname === current.from ? { ...current, visible: true } : null;
                    }),
                120,
            );
            // Navegação que nunca troca de rota (erro, mesma página): a barra não fica presa.
            giveUp = setTimeout(() => setRun((current) => (current?.id === id ? null : current)), 10_000);
        };

        const onClick = (event: MouseEvent) => {
            if (event.defaultPrevented || event.button !== 0) return;
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

            const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;

            if (!(anchor instanceof HTMLAnchorElement)) return;
            if ((anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return;

            const url = new URL(anchor.href, window.location.href);

            // Outro site, ou a mesma página (âncora, mesmo pathname): nada a esperar.
            if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;

            begin();
        };

        // Captura: roda antes do onClick do <Link>, que cancela o evento.
        document.addEventListener('click', onClick, true);
        window.addEventListener('popstate', begin);
        window.addEventListener(START_EVENT, begin);

        return () => {
            clearTimeout(delay);
            clearTimeout(giveUp);
            document.removeEventListener('click', onClick, true);
            window.removeEventListener('popstate', begin);
            window.removeEventListener(START_EVENT, begin);
        };
    }, []);

    const finished = run !== null && pathname !== run.from;

    // Ainda dentro dos 120 ms, ou terminou antes de aparecer: nada na tela.
    if (!run || !run.visible) return null;

    return (
        <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5">
            <div
                key={finished ? 'done' : 'grow'}
                className={finished ? 'nav-progress-done' : 'nav-progress-grow'}
                onAnimationEnd={finished ? () => setRun((current) => (current?.id === run.id ? null : current)) : undefined}
            />
        </div>
    );
}
