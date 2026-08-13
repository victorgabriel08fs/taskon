import { Head, Link, useForm } from '@inertiajs/react';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import AuthLayout from '@/layouts/auth-layout';

export default function Register() {
    const form = useForm({ name: '', email: '', password: '', password_confirmation: '' });

    return (
        <AuthLayout title="Criar conta" description="Leva 20 segundos e já vem com um quadro pronto.">
            <Head title="Criar conta" />

            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    form.post('/register', { onFinish: () => form.reset('password', 'password_confirmation') });
                }}
                className="space-y-5"
            >
                <Field label="Nome" error={form.errors.name}>
                    <Input
                        autoComplete="name"
                        autoFocus
                        required
                        placeholder="Como podemos te chamar?"
                        value={form.data.name}
                        onChange={(event) => form.setData('name', event.target.value)}
                    />
                </Field>

                <Field label="E-mail" error={form.errors.email}>
                    <Input
                        type="email"
                        autoComplete="username"
                        required
                        placeholder="voce@exemplo.com"
                        value={form.data.email}
                        onChange={(event) => form.setData('email', event.target.value)}
                    />
                </Field>

                <Field label="Senha" error={form.errors.password} hint="Pelo menos 8 caracteres.">
                    <Input
                        type="password"
                        autoComplete="new-password"
                        required
                        placeholder="••••••••"
                        value={form.data.password}
                        onChange={(event) => form.setData('password', event.target.value)}
                    />
                </Field>

                <Field label="Confirmar senha" error={form.errors.password_confirmation}>
                    <Input
                        type="password"
                        autoComplete="new-password"
                        required
                        placeholder="••••••••"
                        value={form.data.password_confirmation}
                        onChange={(event) => form.setData('password_confirmation', event.target.value)}
                    />
                </Field>

                <Button type="submit" size="lg" className="w-full" loading={form.processing}>
                    {!form.processing && <Sparkles className="size-4" />}
                    Criar minha conta
                </Button>
            </form>

            <p className="mt-8 text-center text-sm text-muted-fg">
                Já tem conta?{' '}
                <Link href="/login" className="font-semibold text-primary underline-offset-4 hover:underline">
                    Entrar
                </Link>
            </p>
        </AuthLayout>
    );
}
