import { Head, useForm } from '@inertiajs/react';
import { KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import AuthLayout from '@/layouts/auth-layout';

export default function ResetPassword({ token, email }: { token: string; email: string }) {
    const form = useForm({ token, email, password: '', password_confirmation: '' });

    return (
        <AuthLayout title="Nova senha" description="Escolha uma senha que só você saiba.">
            <Head title="Nova senha" />

            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    form.post('/reset-password', { onFinish: () => form.reset('password', 'password_confirmation') });
                }}
                className="space-y-5"
            >
                <Field label="E-mail" error={form.errors.email}>
                    <Input
                        type="email"
                        readOnly
                        value={form.data.email}
                        onChange={(event) => form.setData('email', event.target.value)}
                        className="opacity-70"
                    />
                </Field>

                <Field label="Nova senha" error={form.errors.password}>
                    <Input
                        type="password"
                        autoComplete="new-password"
                        autoFocus
                        required
                        value={form.data.password}
                        onChange={(event) => form.setData('password', event.target.value)}
                    />
                </Field>

                <Field label="Confirmar senha" error={form.errors.password_confirmation}>
                    <Input
                        type="password"
                        autoComplete="new-password"
                        required
                        value={form.data.password_confirmation}
                        onChange={(event) => form.setData('password_confirmation', event.target.value)}
                    />
                </Field>

                <Button type="submit" size="lg" className="w-full" loading={form.processing}>
                    {!form.processing && <KeyRound className="size-4" />}
                    Redefinir senha
                </Button>
            </form>
        </AuthLayout>
    );
}
