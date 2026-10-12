'use client';

import { LogIn } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { useActionForm } from '@/lib/actions';
import { login } from '@/server/actions/auth';

/**
 * A tela existe para isto: o foco já vai para o e-mail, no commit, como o
 * `autoFocus` faria. Fixa, fora do componente — uma função nova a cada render
 * seria chamada de novo a cada tecla e puxaria o foco de volta para cá.
 */
const focusOnMount = (node: HTMLInputElement | null) => node?.focus();

/**
 * `next` é o caminho que a pessoa tentou abrir antes de cair no login (o
 * `?next=` que o proxy anota). A action confere de novo se ele é interno.
 */
export function LoginForm({ next }: { next: string | null }) {
    const form = useActionForm({ email: '', password: '', remember: false, next }, login);

    return (
        <>
            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    form.submit({ onFinish: () => form.reset('password') });
                }}
                className="space-y-5"
            >
                <Field label="E-mail" error={form.errors.email}>
                    <Input
                        type="email"
                        ref={focusOnMount}
                        autoComplete="email"
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
                            className="size-4 accent-primary"
                        />
                        Continuar conectado
                    </label>

                    <Link
                        href="/forgot-password"
                        className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                    >
                        Esqueci a senha
                    </Link>
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
        </>
    );
}
