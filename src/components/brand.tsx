import { LogoMark } from '@/components/logo';
import { cn } from '@/lib/utils';

/**
 * Carregando, no desenho da marca: as três colunas do símbolo sobem e descem
 * em sequência (globals.css, `.raia-loader`). Parado com movimento reduzido.
 */
export function RaiaLoader({ className, label = 'Carregando' }: { className?: string; label?: string }) {
    return (
        <span role="status" aria-label={label} className={cn('inline-grid place-items-center', className)}>
            <LogoMark className="raia-loader size-10" />
        </span>
    );
}

/**
 * Ilustração dos estados vazios: três raias tracejadas que descem do topo e
 * o pingo lima que cai na primeira — "a pista está livre".
 */
export function RaiaEmpty({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 72 52" aria-hidden className={cn('raia-empty h-12 w-auto text-muted-fg/45', className)}>
            <g fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" strokeLinecap="round">
                <rect className="lane" x="8" y="10" width="14" height="38" rx="4" />
                <rect className="lane" x="29" y="10" width="14" height="28" rx="4" />
                <rect className="lane" x="50" y="10" width="14" height="18" rx="4" />
            </g>
            <circle className="pingo" cx="15" cy="5" r="4" />
        </svg>
    );
}

/**
 * Fundo dos painéis da marca (entrada, hero, chamada final): três raias
 * grandes que descem do topo, a primeira em lima, no lugar dos brilhos e
 * gradientes do desenho antigo. Decorativo; parado com movimento reduzido.
 */
export function RaiaLanes({ className }: { className?: string }) {
    return (
        <svg
            viewBox="0 0 300 400"
            preserveAspectRatio="xMidYMin slice"
            aria-hidden
            className={cn('raia-lanes pointer-events-none absolute inset-0 size-full', className)}
        >
            <rect className="lane" x="40" y="-20" width="60" height="330" rx="18" fill="#C6F135" fillOpacity="0.14" />
            <rect className="lane" x="120" y="-20" width="60" height="240" rx="18" fill="currentColor" fillOpacity="0.07" />
            <rect className="lane" x="200" y="-20" width="60" height="150" rx="18" fill="currentColor" fillOpacity="0.04" />
        </svg>
    );
}
