import { cn } from '@/lib/utils';

/**
 * Símbolo (docs/marca/raia-simbolo.svg): quadro grafite com três colunas, a
 * primeira em lima. As colunas ficam em <g class="brand-col"> para as
 * animações da marca (globals.css, bloco "Marca").
 */
export function LogoMark({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 64 64" aria-hidden className={cn('size-9 shrink-0', className)}>
            <rect width="64" height="64" rx="14" fill="#1E2327" />
            <g className="brand-col">
                <rect x="14" y="16" width="10" height="32" rx="3" fill="#C6F135" />
            </g>
            <g className="brand-col">
                <rect x="27" y="16" width="10" height="22" rx="3" fill="#F4F5F0" />
            </g>
            <g className="brand-col">
                <rect x="40" y="16" width="10" height="12" rx="3" fill="#F4F5F0" fillOpacity="0.5" />
            </g>
        </svg>
    );
}

/**
 * Nome desenhado (docs/marca/raia-nome-*.svg): traço em `currentColor` e o
 * pingo do "i" em lima (lima escura no tema claro). Proporção do logotipo:
 * altura do x igual à metade do símbolo, base alinhada ao pé da coluna lima
 * (por isso o `mb` de 1/4 do símbolo no <Logo>).
 */
export function LogoType({ className, onDark = false }: { className?: string; onDark?: boolean }) {
    return (
        <svg viewBox="-5 -7 177 72" aria-hidden className={cn('h-[26px] w-auto', className)}>
            <g fill="none" stroke="currentColor" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 20 V60" />
                <path d="M9 39 C9 27 17 20 28 20 H31" />
                <circle cx="69" cy="40" r="20" />
                <path d="M89 20 V60" />
                <path d="M109 20 V60" />
                <circle cx="147" cy="40" r="20" />
                <path d="M167 20 V60" />
            </g>
            <circle
                className={cn('brand-dot', onDark ? 'fill-[#C6F135]' : 'fill-[#4A6100] dark:fill-[#C6F135]')}
                cx="109"
                cy="0"
                r="6"
            />
        </svg>
    );
}

export function Logo({
    className,
    invert = false,
    compact = false,
    animated = false,
}: {
    className?: string;
    invert?: boolean;
    /** Esconde o nome abaixo de `sm` — no cabeçalho do app a linha é disputada. */
    compact?: boolean;
    /** Toca a "largada" ao montar (home e telas de entrada). */
    animated?: boolean;
}) {
    return (
        <span
            role="img"
            aria-label="Raia"
            className={cn('brand-logo inline-flex items-end gap-[9px]', animated && 'brand-animated', className)}
        >
            <LogoMark />
            <LogoType
                onDark={invert}
                className={cn('mb-[9px]', compact && 'hidden sm:block', invert ? 'text-white' : 'text-foreground')}
            />
        </span>
    );
}
