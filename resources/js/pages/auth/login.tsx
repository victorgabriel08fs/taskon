import { Head, Link, useForm } from '@inertiajs/react';
import { LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import AuthLayout from '@/layouts/auth-layout';

export default function Login({ canResetPassword, status }: { canResetPassword: boolean; status?: string }) {
    const form = useForm({ email: '', password: '', remember: false });

    return (
        <AuthLayout title="Entrar" description="Bom te ver de novo. Seus quadros estão esperando.">
            <Head title="Entrar" />

            {status && (
                <div className="mb-5 animate-pop rounded-lg bg-success/12 px-3.5 py-2.5 text-sm font-medium text-success">
                    {status}
                </div>
            )}

            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    form.post('/login', { onFinish: () => form.reset('password') });
                }}
                className="space-y-5"
            >
                <Field label="E-mail" error={form.errors.email}>
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

                <Field label="Senha" error={form.errors.password}>
                    <Input
                        type="password"
                        autoComplete="current-password"
                        required
                        placeholder="••••••••"
                        value={form.data.password}
                        onChange={(event) => form.setData('password', event.target.value)}
                    />
                </Field>

                <div className="flex items-center justify-between">
                    <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-muted-fg">
                        <input
                            type="checkbox"
                            checked={form.data.remember}
                            onChange={(event) => form.setData('remember', event.target.checked)}
                            className="size-4 accent-[var(--primary)]"
                        />
                        Continuar conectado
                    </label>

                    {canResetPassword && (
                        <Link
                            href="/forgot-password"
                            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                        >
                            Esqueci a senha
                        </Link>
                    )}
                </div>

                <Button type="submit" size="lg" className="w-full" loading={form.processing}>
                    {!form.processing && <LogIn className="size-4" />}
                    Entrar
                </Button>
            </form>

            <p className="mt-8 text-center text-sm text-muted-fg">
                Ainda não tem conta?{' '}
                <Link href="/register" className="font-semibold text-primary underline-offset-4 hover:underline">
                    Criar agora
                </Link>
            </p>
        </AuthLayout>
    );
}
