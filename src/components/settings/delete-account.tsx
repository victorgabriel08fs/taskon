'use client';

import { Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { useActionForm } from '@/lib/actions';
import { deleteAccount } from '@/server/actions/settings';

/**
 * O modal abre para isto: o foco vai para a senha, no commit, como o
 * `autoFocus` faria. Fixa, fora do componente — uma função nova a cada render
 * seria chamada de novo a cada tecla.
 */
const focusOnMount = (node: HTMLInputElement | null) => node?.focus();

/**
 * A zona de perigo do perfil. A senha é pedida num modal, e não num
 * `useConfirm`: a confirmação aqui precisa de um campo, não só de um clique.
 */
export function DeleteAccount() {
    const [confirming, setConfirming] = useState(false);
    const form = useActionForm({ password: '' }, deleteAccount);
    const titleId = useId();

    return (
        <>
            <div className="mt-8 rounded-xl bg-danger/6 p-6 ring-1 ring-danger/20">
                <h3 className="text-sm font-semibold text-danger">Excluir conta</h3>
                <p className="mt-1 text-sm text-muted-fg">
                    Apaga permanentemente sua conta, seus quadros e tudo que estiver dentro deles.
                </p>
                <Button variant="danger" size="sm" className="mt-4" onClick={() => setConfirming(true)}>
                    <Trash2 className="size-4" />
                    Excluir minha conta
                </Button>
            </div>

            <Modal open={confirming} onClose={() => setConfirming(false)} className="max-w-md" labelledBy={titleId}>
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        form.submit();
                    }}
                    className="p-6"
                >
                    <h3 id={titleId} className="text-lg font-semibold">
                        Tem certeza absoluta?
                    </h3>
                    <p className="mt-1.5 text-sm text-muted-fg">
                        Essa ação não pode ser desfeita. Confirme com sua senha para continuar.
                    </p>

                    <Field label="Senha" error={form.errors.password} className="mt-5">
                        <Input
                            type="password"
                            ref={focusOnMount}
                            autoComplete="current-password"
                            value={form.data.password}
                            onChange={(e) => form.setData('password', e.target.value)}
                        />
                    </Field>

                    <div className="mt-6 flex justify-end gap-2">
                        <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
                            Cancelar
                        </Button>
                        <Button type="submit" variant="danger" loading={form.processing}>
                            Excluir para sempre
                        </Button>
                    </div>
                </form>
            </Modal>
        </>
    );
}
