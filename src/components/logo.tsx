import { cn } from '@/lib/utils';

export function LogoMark({ className }: { className?: string }) {
    return (
        <span
            className={cn(
                'relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-[0.7rem]',
                'bg-gradient-to-br from-violet-500 via-fuchsia-500 to-pink-400 shadow-lg shadow-fuchsia-500/25',
                className,
            )}
        >
            <span className="absolute left-[22%] top-[26%] h-[48%] w-[22%] rounded-[3px] bg-white/95" />
            <span className="absolute right-[22%] top-[26%] h-[30%] w-[22%] rounded-[3px] bg-white/70" />
        </span>
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
        <span className={cn('inline-flex items-center gap-2.5', className)}>
            <LogoMark />
            <span
                className={cn(
                    'text-lg font-bold tracking-tight',
                    compact && 'hidden sm:inline',
                    invert ? 'text-white' : 'text-foreground',
                )}
            >
                Taskon
            </span>
        </span>
    );
}
