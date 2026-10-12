'use client';

import { useId } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { useActionForm } from '@/lib/actions';
import { BOARD_BACKGROUND_LABEL, boardBackgroundClass } from '@/lib/palette';
import { cn } from '@/lib/utils';
import { createBoard } from '@/server/actions/boards';
import type { BoardBackground } from '@/types';

/**
 * O modal abre para isto: o foco já vai para o título, no commit, como o
 * `autoFocus` faria. Fixa, fora do componente — uma função nova a cada render
 * seria chamada de novo a cada tecla e tomaria o foco de quem clicou num fundo.
 */
const focusOnMount = (node: HTMLInputElement | null) => node?.focus();

/**
 * Criar um quadro. A action redireciona para o quadro novo (com o aviso
 * "Quadro criado."), então o sucesso nem volta para cá: a tela troca.
 */
export function CreateBoardModal({
    open,
    onClose,
    backgrounds,
}: {
    open: boolean;
    onClose: () => void;
    backgrounds: BoardBackground[];
}) {
    const titleId = useId();
    const form = useActionForm(
        { title: '', background: (backgrounds[0] ?? 'aurora') as BoardBackground },
        createBoard,
    );

    return (
        <Modal open={open} onClose={onClose} className="max-w-md" labelledBy={titleId}>
            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    void form.submit({
                        onSuccess: () => {
                            form.reset();
                            onClose();
                        },
                    });
                }}
                className="p-6"
            >
                <h2 id={titleId} className="text-lg font-semibold">
                    Novo quadro
                </h2>
                <p className="mt-1 text-sm text-muted-fg">Ele já nasce com três listas e etiquetas prontas.</p>

                <div className={cn('mt-5 h-28 rounded-xl shadow-inner', boardBackgroundClass(form.data.background))}>
                    <div className="flex h-full items-end p-4">
                        <p className="truncate text-base font-semibold text-white drop-shadow">
                            {form.data.title || 'Nome do quadro'}
                        </p>
                    </div>
                </div>

                <Field label="Título" error={form.errors.title} className="mt-5">
                    <Input
                        ref={focusOnMount}
                        required
                        maxLength={120}
                        aria-label="Título"
                        placeholder="Ex.: Lançamento do produto"
                        value={form.data.title}
                        onChange={(event) => form.setData('title', event.target.value)}
                    />
                </Field>

                <div className="mt-5">
                    <p className="text-sm font-medium">Fundo</p>
                    <div className="mt-2 grid grid-cols-4 gap-2">
                        {backgrounds.map((background) => (
                            <button
                                key={background}
                                type="button"
                                title={BOARD_BACKGROUND_LABEL[background]}
                                aria-label={BOARD_BACKGROUND_LABEL[background]}
                                aria-pressed={form.data.background === background}
                                onClick={() => form.setData('background', background)}
                                className={cn(
                                    'h-12 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95',
                                    boardBackgroundClass(background),
                                    form.data.background === background &&
                                        'ring-2 ring-primary ring-offset-2 ring-offset-[var(--surface)]',
                                )}
                            />
                        ))}
                    </div>

                    {form.errors.background && (
                        <p className="mt-1.5 animate-pop text-xs font-medium text-danger" role="alert">
                            {form.errors.background}
                        </p>
                    )}
                </div>

                <div className="mt-7 flex justify-end gap-2">
                    <Button type="button" variant="secondary" onClick={onClose}>
                        Cancelar
                    </Button>
                    <Button type="submit" loading={form.processing}>
                        Criar quadro
                    </Button>
                </div>
            </form>
        </Modal>
    );
}
