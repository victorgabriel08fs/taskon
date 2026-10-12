'use client';

import { formatDateTime, formatRelative } from '@/lib/utils';
import { cn } from '@/lib/utils';

/**
 * "há 3 horas" com a data completa no title. O texto depende do relógio, que
 * anda entre o SSR e a hidratação — daí o `suppressHydrationWarning`.
 */
export function TimeAgo({ iso, className }: { iso: string | null | undefined; className?: string }) {
    if (!iso) return null;

    return (
        <time dateTime={iso} title={formatDateTime(iso)} className={cn(className)} suppressHydrationWarning>
            {formatRelative(iso)}
        </time>
    );
}
