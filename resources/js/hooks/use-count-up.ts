import { animate, useMotionValue, useReducedMotion, useTransform, type MotionValue } from 'motion/react';
import { useEffect } from 'react';

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
    const reduced = useReducedMotion();
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
