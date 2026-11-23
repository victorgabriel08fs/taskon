import { cn } from '@/lib/utils';

/** Símbolo (docs/marca/taskon-simbolo.svg): quadro grafite com três colunas, a primeira em lima. */
export function LogoMark({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 64 64" aria-hidden className={cn('size-9 shrink-0', className)}>
            <rect width="64" height="64" rx="14" fill="#1E2327" />
            <rect x="14" y="16" width="10" height="32" rx="3" fill="#C6F135" />
            <rect x="27" y="16" width="10" height="22" rx="3" fill="#F4F5F0" />
            <rect x="40" y="16" width="10" height="12" rx="3" fill="#F4F5F0" fillOpacity="0.5" />
        </svg>
    );
}

/**
 * Nome desenhado (docs/marca/taskon-nome-*.svg), em traço `currentColor`.
 * Proporção do logotipo: altura = 0,7 do símbolo; base alinhada ao pé da
 * coluna lima e altura do x ao topo das colunas (por isso o `mb` de 1/4).
 */
export function LogoType({ className }: { className?: string }) {
    return (
        <svg viewBox="-5 -5 284 70" aria-hidden className={cn('h-[25px] w-auto', className)}>
            <g fill="none" stroke="currentColor" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 2 V45 a15 15 0 0 0 15 15" />
                <path d="M0 20 H23" />
                <g transform="translate(-2 0)">
                    <circle cx="58" cy="40" r="20" />
                    <path d="M78 20 V60" />
                </g>
                <path transform="translate(-3 0)" d="M121 28 C117 20 97 19 97 30 C97 41 122 38 122 50 C122 62 100 62 95 53" />
                <g transform="translate(-5 0)">
                    <path d="M140 0 V60" />
                    <path d="M164 20 L141 43" />
                    <path d="M151 33 L166 60" />
                </g>
                <circle transform="translate(-7 0)" cx="203" cy="40" r="20" />
                <g transform="translate(-8 0)">
                    <path d="M241 20 V60" />
                    <path d="M241 38 C241 26 249 20 259 20 C269 20 277 26 277 38 V60" />
                </g>
            </g>
        </svg>
    );
}

export function Logo({
    className,
    invert = false,
    compact = false,
}: {
    className?: string;
    invert?: boolean;
    /** Esconde o nome abaixo de `sm` — no cabeçalho do app a linha é disputada. */
    compact?: boolean;
}) {
    return (
        <span role="img" aria-label="Taskon" className={cn('inline-flex items-end gap-[9px]', className)}>
            <LogoMark />
            <LogoType className={cn('mb-[9px]', compact && 'hidden sm:block', invert ? 'text-white' : 'text-foreground')} />
        </span>
    );
}
