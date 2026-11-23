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
