'use client';

import { Check, Save } from 'lucide-react';
import { useUser } from '@/components/providers';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { useActionForm } from '@/lib/actions';
import { avatarColorClass } from '@/lib/palette';
import { cn } from '@/lib/utils';
import { updateProfile } from '@/server/actions/settings';
import type { AvatarColor } from '@/types';

/**
 * Nome, cargo, e-mail e cor do avatar. O avatar grande é a prévia: muda de
 * cor e de nome enquanto a pessoa escolhe, antes de salvar.
 */
export function ProfileForm({ avatarColors }: { avatarColors: AvatarColor[] }) {
    const user = useUser();

    // O cargo vem do usuário logado. No legado ele não vinha no `auth.user`, e
    // o formulário abria vazio — salvar sem mexer no campo apagava o cargo.
    const form = useActionForm(
        {
            name: user.name,
            email: user.email,
            title: user.title ?? '',
            avatar_color: user.avatar_color,
        },
        updateProfile,
    );

    return (
        <form
            onSubmit={(event) => {
                event.preventDefault();
                form.submit();
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
                                aria-pressed={form.data.avatar_color === color}
                                onClick={() => form.setData('avatar_color', color)}
                                className={cn(
                                    'grid size-8 place-items-center rounded-full transition-transform duration-200',
                                    'hover:scale-115 active:scale-95',
                                    avatarColorClass(color),
                                    form.data.avatar_color === color &&
                                        'ring-2 ring-primary ring-offset-2 ring-offset-surface',
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
    );
}
