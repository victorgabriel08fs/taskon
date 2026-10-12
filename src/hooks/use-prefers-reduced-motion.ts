import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * O bloco global do `app.css` zera transição e animação CSS, mas não alcança
 * nada que o `motion` anime por JS (BOAS_PRATICAS §12.6) — aí a checagem tem
 * de ser explícita.
 *
 * E não dá para usar o `useReducedMotion()` do `motion`: ele é um retrato
 * tirado na montagem (`useState(prefersReducedMotion.current)`, sem setter,
 * com um TODO no próprio pacote). Para um widget que nasce no boot e nunca
 * desmonta, isso significa ignorar a preferência se ela mudar durante a
 * sessão. Aqui a media query fica escutando.
 */
let media: MediaQueryList | null = null;

/** Uma só `MediaQueryList` para o app inteiro — `getSnapshot` roda a cada render. */
function query(): MediaQueryList {
    media ??= window.matchMedia(QUERY);

    return media;
}

function subscribe(callback: () => void): () => void {
    query().addEventListener('change', callback);

    return () => query().removeEventListener('change', callback);
}

export function usePrefersReducedMotion(): boolean {
    return useSyncExternalStore(
        subscribe,
        () => query().matches,
        () => false,
    );
}
