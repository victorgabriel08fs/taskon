import { Head, useForm } from '@inertiajs/react';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import SettingsLayout from '@/layouts/settings-layout';

export default function PasswordSettings() {
    const form = useForm({ current_password: '', password: '', password_confirmation: '' });

    return (
        <SettingsLayout title="Senha" description="Use uma senha longa e exclusiva desta conta.">
            <Head title="Senha" />

            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    form.put('/settings/password', {
                        preserveScroll: true,
                        onSuccess: () => form.reset(),
                    });
                }}
                className="max-w-md space-y-5 rounded-xl bg-surface p-6 ring-1 ring-border"
            >
                <Field label="Senha atual" error={form.errors.current_password}>
                    <Input
                        type="password"
                        autoComplete="current-password"
                        value={form.data.current_password}
                        onChange={(e) => form.setData('current_password', e.target.value)}
                    />
                </Field>

                <Field label="Nova senha" error={form.errors.password} hint="Pelo menos 8 caracteres.">
                    <Input
                        type="password"
                        autoComplete="new-password"
                        value={form.data.password}
                        onChange={(e) => form.setData('password', e.target.value)}
                    />
                </Field>

                <Field label="Confirmar nova senha" error={form.errors.password_confirmation}>
                    <Input
                        type="password"
                        autoComplete="new-password"
                        value={form.data.password_confirmation}
                        onChange={(e) => form.setData('password_confirmation', e.target.value)}
                    />
                </Field>

                <div className="flex items-center gap-3">
                    <Button type="submit" loading={form.processing}>
                        {!form.processing && <ShieldCheck className="size-4" />}
                        Alterar senha
                    </Button>

                    {form.recentlySuccessful && (
                        <span className="animate-pop text-sm font-medium text-success">Senha alterada!</span>
                    )}
                </div>
            </form>
        </SettingsLayout>
    );
}
