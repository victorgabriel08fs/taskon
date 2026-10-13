'use client';

import { Sparkles } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { useActionForm } from '@/lib/actions';
import { register } from '@/server/actions/auth';

/** O foco já vai para o nome, no commit, como o `autoFocus` faria (ver login-form.tsx). */
const focusOnMount = (node: HTMLInputElement | null) => node?.focus();

/** O convite que trouxe a pessoa até aqui (/register?invite=…), se ainda vale. */
export interface RegisterInvite {
    token: string;
    email: string;
    boardTitle: string;
}

export function RegisterForm({ invite }: { invite: RegisterInvite | null }) {
    const form = useActionForm(
        { name: '', email: invite?.email ?? '', password: '', password_confirmation: '', invite: invite?.token ?? null },
        register,
    );

    return (
        <>
            {invite && (
                <div role="status" className="mb-5 rounded-lg bg-primary-soft px-3.5 py-2.5 text-sm text-foreground">
                    Crie sua conta para entrar no quadro <span className="font-semibold">{invite.boardTitle}</span>.
                </div>
            )}

            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    form.submit({ onFinish: () => form.reset('password', 'password_confirmation') });
                }}
                className="space-y-5"
            >
                <Field label="Nome" error={form.errors.name}>
                    <Input
                        ref={focusOnMount}
                        autoComplete="name"
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
                <Link
                    // Com convite, o login volta para a página do convite, que aceita com um clique.
                    href={invite ? `/login?next=${encodeURIComponent(`/invite/${invite.token}`)}` : '/login'}
                    className="font-semibold text-primary underline-offset-4 hover:underline"
                >
                    Entrar
                </Link>
            </p>
        </>
    );
}
