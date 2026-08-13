import { Head, useForm, usePage } from '@inertiajs/react';
import { Check, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import SettingsLayout from '@/layouts/settings-layout';
import { avatarColorClass } from '@/lib/palette';
import { cn } from '@/lib/utils';
import type { AvatarColor } from '@/types';

export default function Profile({ avatarColors }: { avatarColors: AvatarColor[] }) {
    const user = usePage().props.auth.user!;
    const [confirming, setConfirming] = useState(false);

    const form = useForm({
        name: user.name,
        email: user.email,
        title: user.title ?? '',
        avatar_color: user.avatar_color,
    });

    const deleteForm = useForm({ password: '' });

    return (
        <SettingsLayout title="Perfil" description="Como você aparece para o resto do time.">
            <Head title="Perfil" />

            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    form.patch('/settings/profile', { preserveScroll: true });
                }}
                className="space-y-6 rounded-xl bg-surface p-6 ring-1 ring-border"
            >
                <div className="flex items-center gap-5">
                    <Avatar
                        user={{ name: form.data.name, initials: user.initials, avatar_color: form.data.avatar_color }}
                        size="xl"
                    />

                    <div>
                        <p className="text-sm font-medium">Cor do avatar</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                            {avatarColors.map((color) => (
                                <button
                                    key={color}
                                    type="button"
                                    aria-label={color}
                                    onClick={() => form.setData('avatar_color', color)}
                                    className={cn(
                                        'grid size-8 place-items-center rounded-full transition-transform duration-200',
                                        'hover:scale-115 active:scale-95',
                                        avatarColorClass(color),
                                        form.data.avatar_color === color && 'ring-2 ring-primary ring-offset-2 ring-offset-[var(--surface)]',
                                    )}
                                >
                                    {form.data.avatar_color === color && <Check className="size-4 text-white" />}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                    <Field label="Nome" error={form.errors.name}>
                        <Input value={form.data.name} onChange={(e) => form.setData('name', e.target.value)} required />
                    </Field>

                    <Field label="Cargo" error={form.errors.title} hint="Opcional.">
                        <Input
                            value={form.data.title}
                            onChange={(e) => form.setData('title', e.target.value)}
                            placeholder="Ex.: Desenvolvedor"
                        />
                    </Field>
                </div>

                <Field label="E-mail" error={form.errors.email}>
                    <Input
                        type="email"
                        value={form.data.email}
                        onChange={(e) => form.setData('email', e.target.value)}
                        required
                    />
                </Field>

                <div className="flex items-center gap-3">
                    <Button type="submit" loading={form.processing}>
                        {!form.processing && <Save className="size-4" />}
                        Salvar
                    </Button>

                    {form.recentlySuccessful && (
                        <span className="animate-pop text-sm font-medium text-success">Salvo!</span>
                    )}
                </div>
            </form>

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

            <Modal open={confirming} onClose={() => setConfirming(false)} className="max-w-md">
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        deleteForm.delete('/settings/profile');
                    }}
                    className="p-6"
                >
                    <h3 className="text-lg font-semibold">Tem certeza absoluta?</h3>
                    <p className="mt-1.5 text-sm text-muted-fg">
                        Essa ação não pode ser desfeita. Confirme com sua senha para continuar.
                    </p>

                    <Field label="Senha" error={deleteForm.errors.password} className="mt-5">
                        <Input
                            type="password"
                            autoFocus
                            value={deleteForm.data.password}
                            onChange={(e) => deleteForm.setData('password', e.target.value)}
                        />
                    </Field>

                    <div className="mt-6 flex justify-end gap-2">
                        <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
                            Cancelar
                        </Button>
                        <Button type="submit" variant="danger" loading={deleteForm.processing}>
                            Excluir para sempre
                        </Button>
                    </div>
                </form>
            </Modal>
        </SettingsLayout>
    );
}
