import { useCallback, useState, type PointerEvent, type ReactNode } from 'react';

interface Ripple {
    id: number;
    x: number;
    y: number;
    size: number;
}

let sequence = 0;

/**
 * Ondinha de clique que nasce exatamente onde o ponteiro tocou.
 *
 * O elemento hospedeiro precisa de `position: relative` e `overflow: hidden`.
 * A limpeza acontece no `onAnimationEnd` — nada de setTimeout pendurado.
 */
export function useRipple(color = 'currentColor') {
    const [items, setItems] = useState<Ripple[]>([]);

    const spawn = useCallback((event: PointerEvent<HTMLElement>) => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

        const target = event.currentTarget;
        const rect = target.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height);

        setItems((current) => [
            ...current,
            {
                id: ++sequence,
                x: event.clientX - rect.left - size / 2,
                y: event.clientY - rect.top - size / 2,
                size,
            },
        ]);
    }, []);

    const ripples: ReactNode = items.map((ripple) => (
        <span
            key={ripple.id}
            aria-hidden
            onAnimationEnd={() => setItems((current) => current.filter((item) => item.id !== ripple.id))}
            className="pointer-events-none absolute -z-10 rounded-full animate-ripple"
            style={{
                left: ripple.x,
                top: ripple.y,
                width: ripple.size,
                height: ripple.size,
                backgroundColor: color,
                opacity: 0.35,
            }}
        />
    ));

    return { ripples, spawn } as const;
}
