'use client';

import { KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { useActionForm } from '@/lib/actions';
import { resetPassword } from '@/server/actions/auth';

/** O e-mail já vem do link: o foco vai direto para a senha nova (ver login-form.tsx). */
const focusOnMount = (node: HTMLInputElement | null) => node?.focus();

/** `token` e `email` vêm do link do e-mail (/reset-password/{token}?email=…). */
export function ResetPasswordForm({ token, email }: { token: string; email: string }) {
    const form = useActionForm({ token, email, password: '', password_confirmation: '' }, resetPassword);

    return (
        <form
            onSubmit={(event) => {
                event.preventDefault();
                form.submit({ onFinish: () => form.reset('password', 'password_confirmation') });
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
                    ref={focusOnMount}
                    autoComplete="new-password"
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
    );
}
