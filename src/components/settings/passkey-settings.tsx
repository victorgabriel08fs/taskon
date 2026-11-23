'use client';

import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser';
import { Cloud, KeyRound, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { useUser } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { Field, Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { TimeAgo } from '@/components/time-ago';
import { runAction, useActionForm } from '@/lib/actions';
import { PASSKEY_UNSUPPORTED, isCeremonyCancel, registrationErrorMessage, syncPasskeys } from '@/lib/passkeys';
import { formatDate } from '@/lib/utils';
import { deletePasskey, finishPasskeyRegistration, renamePasskey, startPasskeyRegistration } from '@/server/actions/passkeys';
import type { Passkey, PasskeySettingsData } from '@/types';

/**
 * Configurações › Passkeys: a lista das passkeys da conta (renomear,
 * remover) e o cadastro neste aparelho. A moldura vem do SettingsLayout.
 */
export function PasskeySettings({ passkeys, webauthn_user_id, max }: PasskeySettingsData) {
    const user = useUser();
    const [adding, setAdding] = useState(false);
    const { confirm, dialog } = useConfirm();
    const full = passkeys.length >= max;

    // A cada lista nova (e na primeira visita), o aparelho fica sabendo quais
    // passkeys ainda valem e qual o e-mail de agora: a removida aqui, ou em
    // outro aparelho, some do preenchimento automático.
    const accepted = passkeys.map((passkey) => passkey.credential_id).join(' ');

    useEffect(() => {
        if (!webauthn_user_id) return;

        syncPasskeys(
            { webauthnUserId: webauthn_user_id, email: user.email, name: user.name },
            accepted ? accepted.split(' ') : [],
        );
    }, [webauthn_user_id, accepted, user.email, user.name]);

    return (
        <div className="max-w-xl space-y-4">
            <div className="overflow-hidden rounded-xl bg-surface ring-1 ring-border">
                <div className="flex items-start gap-4 p-5">
                    <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
                        <KeyRound className="size-5" />
                    </span>

                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">Suas passkeys</p>
                        <p className="mt-0.5 text-sm text-muted-fg">
                            Cadastre em mais de um aparelho para não depender de um só. A senha continua valendo.
                        </p>
                    </div>

                    <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold tabular-nums text-muted-fg">
                        {passkeys.length} de {max}
                    </span>
                </div>

                {passkeys.length === 0 ? (
                    <p className="border-t border-border px-5 py-6 text-center text-sm text-muted-fg">
                        Nenhuma passkey ainda. Cadastre a primeira e entre sem digitar a senha.
                    </p>
                ) : (
                    <ul className="divide-y divide-border border-t border-border">
                        {passkeys.map((passkey) => (
                            <PasskeyRow
                                key={passkey.id}
                                passkey={passkey}
                                onRemove={() =>
                                    confirm({
                                        title: `Remover a passkey "${passkey.name}"?`,
                                        description:
                                            passkeys.length === 1
                                                ? 'Ela deixa de entrar na Raia. Você continua entrando com a senha.'
                                                : 'Ela deixa de entrar na Raia. As outras continuam valendo.',
                                        confirmLabel: 'Remover passkey',
                                        onConfirm: () => void runAction(() => deletePasskey({ passkeyId: passkey.id })),
                                    })
                                }
                            />
                        ))}
                    </ul>
                )}

                <div className="border-t border-border bg-surface-2/40 px-5 py-4">
                    <Button onClick={() => setAdding(true)} disabled={full}>
                        <Plus className="size-4" />
                        Cadastrar passkey neste aparelho
                    </Button>

                    {full && (
                        <p className="mt-2 text-xs text-muted-fg">
                            Você chegou ao máximo de {max}. Remova uma que não usa mais para cadastrar outra.
                        </p>
                    )}
                </div>
            </div>

            <div className="flex gap-3 rounded-xl px-1 text-xs text-muted-fg">
                <ShieldCheck className="mt-0.5 size-4 shrink-0" />
                <p>
                    A passkey fica no aparelho (ou no gerenciador de senhas dele) e só funciona neste site — um site falso
                    não consegue usá-la. A Raia guarda só a parte pública dela.
                </p>
            </div>

            <AddPasskeyModal open={adding} onClose={() => setAdding(false)} />
            {dialog}
        </div>
    );
}

/**
 * O campo do nome só aparece porque a pessoa clicou para renomear, então o
 * foco vai junto — no commit, como o `autoFocus` faria.
 */
const focusOnMount = (node: HTMLInputElement | null) => node?.select();

function PasskeyRow({ passkey, onRemove }: { passkey: Passkey; onRemove: () => void }) {
    const [editing, setEditing] = useState(false);
    const [name, setName] = useState(passkey.name);

    const startEditing = () => {
        setName(passkey.name);
        setEditing(true);
    };

    const save = () => {
        const value = name.trim();

        setEditing(false);

        if (!value || value === passkey.name) return;

        void runAction(() => renamePasskey({ passkeyId: passkey.id, name: value }));
    };

    return (
        <li className="flex items-center gap-3 px-5 py-3.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted-fg">
                <KeyRound className="size-4" />
            </span>

            <div className="min-w-0 flex-1">
                {editing ? (
                    <input
                        ref={focusOnMount}
                        value={name}
                        maxLength={60}
                        aria-label="Nome da passkey"
                        onChange={(event) => setName(event.target.value)}
                        onBlur={save}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') save();
                            if (event.key === 'Escape') {
                                // Só o campo: o Esc não fecha mais nada junto.
                                event.preventDefault();
                                setEditing(false);
                            }
                        }}
                        className="w-full rounded-md bg-surface px-2 py-1 text-sm font-medium ring-2 ring-primary focus:outline-none"
                    />
                ) : (
                    <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium">{passkey.name}</p>

                        {passkey.synced && (
                            <span
                                title="Salva na nuvem do provedor: vale também nos outros aparelhos da mesma conta dele."
                                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary-soft px-1.5 py-0.5 text-[10px] font-semibold text-primary"
                            >
                                <Cloud className="size-3" />
                                Sincronizada
                            </span>
                        )}
                    </div>
                )}

                <p className="mt-0.5 truncate text-xs text-muted-fg">
                    Criada em {formatDate(passkey.created_at)} ·{' '}
                    {passkey.last_used_at ? (
                        <>
                            usada <TimeAgo iso={passkey.last_used_at} />
                        </>
                    ) : (
                        'ainda não usada'
                    )}
                </p>
            </div>

            <button
                type="button"
                title="Renomear"
                aria-label={`Renomear a passkey ${passkey.name}`}
                onClick={startEditing}
                className="rounded-md p-1.5 text-muted-fg transition-colors hover:bg-surface-2 hover:text-foreground"
            >
                <Pencil className="size-4" />
            </button>

            <button
                type="button"
                title="Remover"
                aria-label={`Remover a passkey ${passkey.name}`}
                onClick={onRemove}
                className="rounded-md p-1.5 text-muted-fg transition-colors hover:bg-danger/10 hover:text-danger"
            >
                <Trash2 className="size-4" />
            </button>
        </li>
    );
}

/**
 * O modal abre para isto: o foco vai para o primeiro campo, no commit.
 */
const focusFirst = (node: HTMLInputElement | null) => node?.focus();

/**
 * Cadastrar: a senha atual primeiro (o servidor só entrega o desafio depois
 * dela), depois o diálogo do aparelho, depois a conferência. A senha fica no
 * campo se o aparelho cancelar: tentar de novo é um clique.
 */
function AddPasskeyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const titleId = useId();
    const form = useActionForm({ name: '', current_password: '' }, (data) =>
        startPasskeyRegistration({ current_password: data.current_password }),
    );
    const [step, setStep] = useState<'idle' | 'device' | 'saving'>('idle');
    const [notice, setNotice] = useState<{ tone: 'muted' | 'danger'; text: string } | null>(null);
    const busy = form.processing || step !== 'idle';

    const close = () => {
        if (busy) return;

        form.reset();
        form.clearErrors();
        setNotice(null);
        onClose();
    };

    const submit = async () => {
        if (!browserSupportsWebAuthn()) {
            setNotice({ tone: 'danger', text: PASSKEY_UNSUPPORTED });

            return;
        }

        setNotice(null);

        const started = await form.submit();

        if (!started?.ok) return;

        setStep('device');

        let response;

        try {
            response = await startRegistration({ optionsJSON: started.data });
        } catch (failure) {
            setStep('idle');
            setNotice(
                isCeremonyCancel(failure)
                    ? { tone: 'muted', text: 'O cadastro foi cancelado no aparelho. Tente de novo quando quiser.' }
                    : { tone: 'danger', text: registrationErrorMessage(failure) },
            );

            return;
        }

        setStep('saving');

        // O aviso de sucesso (ou de recusa) vem do servidor, em toast.
        const finished = await runAction(() => finishPasskeyRegistration({ response, name: form.data.name.trim() || null }));

        setStep('idle');

        if (!finished?.ok) return;

        form.reset();
        onClose();
    };

    return (
        <Modal open={open} onClose={close} className="max-w-md" labelledBy={titleId}>
            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    void submit();
                }}
                className="p-6"
            >
                <h3 id={titleId} className="text-lg font-semibold">
                    Cadastrar passkey
                </h3>
                <p className="mt-1.5 text-sm text-muted-fg">
                    Confirme sua senha. Depois, o navegador pede a digital, o rosto ou o PIN do aparelho para criar a passkey.
                </p>

                <div className="mt-5 space-y-4">
                    <Field
                        label="Nome (opcional)"
                        error={form.errors.name}
                        hint="Para reconhecer na lista. Em branco, ela leva o nome do navegador (ex.: Chrome no Windows)."
                    >
                        <Input
                            ref={focusFirst}
                            maxLength={60}
                            placeholder="iPhone, notebook do trabalho…"
                            value={form.data.name}
                            onChange={(event) => form.setData('name', event.target.value)}
                        />
                    </Field>

                    <Field label="Senha atual" error={form.errors.current_password}>
                        <Input
                            type="password"
                            autoComplete="current-password"
                            required
                            value={form.data.current_password}
                            onChange={(event) => form.setData('current_password', event.target.value)}
                        />
                    </Field>
                </div>

                <p
                    role={notice?.tone === 'danger' ? 'alert' : 'status'}
                    className={
                        notice?.tone === 'danger'
                            ? 'mt-4 animate-pop text-xs font-medium text-danger'
                            : 'mt-4 text-xs text-muted-fg'
                    }
                >
                    {step === 'device'
                        ? 'Siga as instruções do navegador para criar a passkey…'
                        : step === 'saving'
                          ? 'Guardando a passkey…'
                          : notice?.text}
                </p>

                <div className="mt-6 flex justify-end gap-2">
                    <Button type="button" variant="secondary" onClick={close} disabled={busy}>
                        Cancelar
                    </Button>
                    <Button type="submit" loading={busy} disabled={!form.data.current_password}>
                        {!busy && <KeyRound className="size-4" />}
                        Continuar
                    </Button>
                </div>
            </form>
        </Modal>
    );
}
