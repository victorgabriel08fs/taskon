'use client';

import { useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';

/**
 * Confirmação para ações destrutivas. Usar em vez do window.confirm(): o
 * nativo bloqueia a thread e quebra a continuidade visual da interface.
 */
export function useConfirm() {
    const [state, setState] = useState<{
        open: boolean;
        title: string;
        description?: string;
        confirmLabel: string;
        onConfirm: () => void;
    }>({ open: false, title: '', confirmLabel: 'Confirmar', onConfirm: () => {} });

    const confirm = (options: {
        title: string;
        description?: string;
        confirmLabel?: string;
        onConfirm: () => void;
    }) =>
        setState({
            open: true,
            title: options.title,
            description: options.description,
            confirmLabel: options.confirmLabel ?? 'Confirmar',
            onConfirm: options.onConfirm,
        });

    const close = () => setState((current) => ({ ...current, open: false }));

    const dialog: ReactNode = (
        <Modal open={state.open} onClose={close} className="max-w-sm" hideClose>
            <div className="p-6 text-center">
                <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-danger/12 text-danger">
                    <AlertTriangle className="size-6" />
                </div>

                <h3 className="text-base font-semibold">{state.title}</h3>
                {state.description && <p className="mt-1.5 text-sm text-muted-fg">{state.description}</p>}

                <div className="mt-6 flex gap-2">
                    <Button variant="secondary" className="flex-1" onClick={close}>
                        Cancelar
                    </Button>
                    <Button
                        variant="danger"
                        className="flex-1"
                        onClick={() => {
                            state.onConfirm();
                            close();
                        }}
                    >
                        {state.confirmLabel}
                    </Button>
                </div>
            </div>
        </Modal>
    );

    return { confirm, dialog } as const;
}
