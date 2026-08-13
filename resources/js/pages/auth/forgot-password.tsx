import { Head, Link, useForm } from '@inertiajs/react';
import { Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import AuthLayout from '@/layouts/auth-layout';

export default function ForgotPassword({ status }: { status?: string }) {
    const form = useForm({ email: '' });

    return (
        <AuthLayout
            title="Recuperar senha"
            description="Enviamos um link para você definir uma senha nova."
        >
            <Head title="Recuperar senha" />

            {status && (
                <div className="mb-5 animate-pop rounded-lg bg-success/12 px-3.5 py-2.5 text-sm font-medium text-success">
                    {status}
                </div>
            )}

            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    form.post('/forgot-password');
                }}
                className="space-y-5"
            >
                <Field
                    label="E-mail"
                    error={form.errors.email}
                    hint="Em ambiente local o e-mail cai em storage/logs/laravel.log."
                >
                    <Input
                        type="email"
                        autoComplete="email"
                        autoFocus
                        required
                        placeholder="voce@exemplo.com"
                        value={form.data.email}
                        onChange={(event) => form.setData('email', event.target.value)}
                    />
                </Field>

                <Button type="submit" size="lg" className="w-full" loading={form.processing}>
                    {!form.processing && <Mail className="size-4" />}
                    Enviar link
                </Button>
            </form>

            <p className="mt-8 text-center text-sm text-muted-fg">
                Lembrou?{' '}
                <Link href="/login" className="font-semibold text-primary underline-offset-4 hover:underline">
                    Voltar para o login
                </Link>
            </p>
        </AuthLayout>
    );
}
