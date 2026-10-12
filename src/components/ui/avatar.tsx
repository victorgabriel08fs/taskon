'use client';

import { avatarColorClass } from '@/lib/palette';
import { cn } from '@/lib/utils';
import type { User } from '@/types';

const SIZES = {
    xs: 'size-5 text-[9px]',
    sm: 'size-7 text-[10px]',
    md: 'size-9 text-xs',
    lg: 'size-12 text-sm',
    xl: 'size-20 text-2xl',
} as const;

export function Avatar({
    user,
    size = 'md',
    className,
    ring = false,
}: {
    user: Pick<User, 'name' | 'initials' | 'avatar_color'>;
    size?: keyof typeof SIZES;
    className?: string;
    ring?: boolean;
}) {
    return (
        <span
            title={user.name}
            className={cn(
                'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold tracking-wide',
                'shadow-sm transition-transform duration-200 hover:scale-110',
                ring && 'ring-2 ring-surface',
                avatarColorClass(user.avatar_color),
                SIZES[size],
                className,
            )}
        >
            {user.initials}
        </span>
    );
}

export function AvatarStack({ users, max = 4, size = 'sm' }: { users: User[]; max?: number; size?: keyof typeof SIZES }) {
    const visible = users.slice(0, max);
    const rest = users.length - visible.length;

    return (
        <div className="flex -space-x-2">
            {visible.map((user) => (
                <Avatar key={user.id} user={user} size={size} ring />
            ))}
            {rest > 0 && (
                <span
                    className={cn(
                        'inline-flex items-center justify-center rounded-full bg-surface-3 font-semibold text-muted-fg ring-2 ring-surface',
                        SIZES[size],
                    )}
                >
                    +{rest}
                </span>
            )}
        </div>
    );
}
