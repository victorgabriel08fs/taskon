import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PopoverProps {
    /** Recebe `open` para o gatilho poder refletir o estado. */
    trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
    children: (props: { close: () => void }) => ReactNode;
    align?: 'left' | 'right' | 'center';
    className?: string;
    title?: string;
}

export function Popover({ trigger, children, align = 'left', className, title }: PopoverProps) {
    const [open, setOpen] = useState(false);
    const root = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;

        const onPointerDown = (event: MouseEvent) => {
            if (root.current && !root.current.contains(event.target as Node)) {
                setOpen(false);
            }
        };

        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                setOpen(false);
            }
        };

        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onKey);

        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    return (
        <div ref={root} className="relative">
            {trigger({ open, toggle: () => setOpen((value) => !value) })}

            <AnimatePresence>
                {open && (
                    <motion.div
                        initial={{ opacity: 0, y: -6, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -4, scale: 0.98 }}
                        transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
                        className={cn(
                            'absolute z-40 mt-2 w-72 origin-top overflow-hidden rounded-xl bg-surface p-1.5 shadow-[var(--shadow-float)] ring-1 ring-border',
                            align === 'right' && 'right-0',
                            align === 'left' && 'left-0',
                            align === 'center' && 'left-1/2 -translate-x-1/2',
                            className,
                        )}
                    >
                        {title && (
                            <p className="border-b border-border px-2.5 pb-2 pt-1.5 text-center text-xs font-semibold uppercase tracking-wide text-muted-fg">
                                {title}
                            </p>
                        )}
                        <div className={cn(title && 'pt-1.5')}>{children({ close: () => setOpen(false) })}</div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

export function PopoverItem({
    icon,
    children,
    onClick,
    danger,
    className,
}: {
    icon?: ReactNode;
    children: ReactNode;
    onClick?: () => void;
    danger?: boolean;
    className?: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                danger ? 'text-danger hover:bg-danger/10' : 'text-foreground hover:bg-surface-2',
                className,
            )}
        >
            {icon}
            {children}
        </button>
    );
}
