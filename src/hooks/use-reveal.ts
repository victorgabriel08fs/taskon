import { useEffect, useRef } from 'react';

/**
 * Revelação no scroll com IntersectionObserver — um observer por página,
 * sem listener de scroll e sem trabalho na main thread a cada frame.
 *
 * Uso: <section ref={useReveal()} className="reveal"> ... </section>
 * ou marque filhos com [data-reveal] dentro do container observado.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>(options?: IntersectionObserverInit) {
    const ref = useRef<T>(null);

    useEffect(() => {
        const root = ref.current;

        if (!root) return;

        const targets: Element[] = [root, ...Array.from(root.querySelectorAll('[data-reveal]'))];

        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            targets.forEach((el) => el.classList.add('revealed'));

            return;
        }

        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add('revealed');
                        observer.unobserve(entry.target);
                    }
                });
            },
            { rootMargin: '0px 0px -12% 0px', threshold: 0.15, ...options },
        );

        targets.forEach((el) => observer.observe(el));

        return () => observer.disconnect();
    }, [options]);

    return ref;
}
