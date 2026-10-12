'use client';

import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

interface ModalProps {
    open: boolean;
    onClose: () => void;
    children: ReactNode;
    className?: string;
    /** Some o botão de fechar quando o conteúdo já tem o seu. */
    hideClose?: boolean;
    labelledBy?: string;
}

const noop = () => () => {};

/**
 * Verdadeiro só no navegador, já hidratado. O SSR e o primeiro render do
 * cliente concordam (os dois sem portal) e o modal aparece logo em seguida —
 * sem isso, um deep link com o card aberto daria erro de hidratação.
 */
function useIsClient(): boolean {
    return useSyncExternalStore(noop, () => true, () => false);
}

/**
 * Modais abertos, do mais antigo ao mais novo. Só o do topo responde ao Esc:
 * a confirmação aberta por cima do card fecha sozinha, sem levar o card junto.
 */
const openModals: symbol[] = [];

export function Modal({ open, onClose, children, className, hideClose, labelledBy }: ModalProps) {
    // Em ref para o efeito abaixo depender só de `open`: se ele re-rodasse a
    // cada `onClose` novo do pai, este modal voltaria ao topo da pilha.
    const onCloseRef = useRef(onClose);

    useEffect(() => {
        onCloseRef.current = onClose;
    });

    useEffect(() => {
        if (!open) return;

        const token = Symbol('modal');

        openModals.push(token);

        const onKey = (event: KeyboardEvent) => {
            // Esc já usado por um campo (cancelar edição) ou por um popover não
            // fecha o modal; e só o modal do topo da pilha fecha.
            if (event.key !== 'Escape' || event.defaultPrevented) return;
            if (openModals[openModals.length - 1] !== token) return;

            event.preventDefault();
            onCloseRef.current();
        };

        // Trava o scroll do fundo sem "pular" o layout quando a barra some.
        const width = window.innerWidth - document.documentElement.clientWidth;
        const previous = document.body.style.cssText;

        document.body.style.overflow = 'hidden';
        document.body.style.paddingRight = `${width}px`;
        document.addEventListener('keydown', onKey);

        return () => {
            openModals.splice(openModals.indexOf(token), 1);
            document.body.style.cssText = previous;
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const isClient = useIsClient();

    if (!isClient) return null;

    return createPortal(
        <AnimatePresence>
            {open && (
                <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.18 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-slate-950/55 backdrop-blur-[3px]"
                        aria-hidden
                    />

                    <motion.div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby={labelledBy}
                        initial={{ opacity: 0, y: 26, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 14, scale: 0.98 }}
                        transition={{ type: 'spring', stiffness: 380, damping: 32, mass: 0.7 }}
                        className={cn(
                            'relative my-auto w-full max-w-lg rounded-xl bg-surface text-foreground shadow-[var(--shadow-float)] ring-1 ring-border',
                            className,
                        )}
                    >
                        {!hideClose && (
                            <button
                                type="button"
                                onClick={onClose}
                                aria-label="Fechar"
                                className="absolute right-3 top-3 z-10 rounded-lg p-1.5 text-muted-fg transition-colors hover:bg-surface-2 hover:text-foreground"
                            >
                                <X className="size-4.5" />
                            </button>
                        )}
                        {children}
                    </motion.div>
                </div>
            )}
        </AnimatePresence>,
        document.body,
    );
}
