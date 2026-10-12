import { animate, useMotionValue, useTransform, type MotionValue } from 'motion/react';
import { useEffect } from 'react';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';

/**
 * Número que sobe de 0 até o valor.
 *
 * Devolve um MotionValue<string> para ser renderizado direto —
 * `<motion.span>{count}</motion.span>` — em vez de setState a cada frame. O
 * React não re-renderiza nada: o motion escreve no nó de texto.
 *
 * O bloco global de prefers-reduced-motion do CSS não alcança animação em JS,
 * então a checagem é explícita aqui.
 */
export function useCountUp(value: number, duration = 0.9): MotionValue<string> {
    // Não o `useReducedMotion()` do motion: ele responde null no SSR e true na
    // hidratação para quem pediu menos movimento — o HTML nasceria com "0" e o
    // cliente com o número final, erro de hidratação. Este responde "não" nos
    // dois lados e o efeito abaixo corrige logo depois.
    const reduced = usePrefersReducedMotion();
    const raw = useMotionValue(reduced ? value : 0);

    useEffect(() => {
        if (reduced) {
            raw.set(value);

            return;
        }

        const controls = animate(raw, value, { duration, ease: [0.22, 1, 0.36, 1] });

        return () => controls.stop();
    }, [duration, raw, reduced, value]);

    return useTransform(raw, (current) => Math.round(current).toLocaleString('pt-BR'));
}
