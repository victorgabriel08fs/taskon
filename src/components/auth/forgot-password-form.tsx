'use client';

import { Mail } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { useActionForm } from '@/lib/actions';
import { sendPasswordResetLink } from '@/server/actions/auth';

/** O foco já vai para o e-mail, no commit, como o `autoFocus` faria (ver login-form.tsx). */
const focusOnMount = (node: HTMLInputElement | null) => node?.focus();

/**
 * `hint` só chega no desenvolvimento sem serviço de e-mail configurado: aí o
 * link não sai de verdade, aparece no terminal do servidor.
 */
export function ForgotPasswordForm({ hint }: { hint?: string }) {
    const form = useActionForm({ email: '' }, sendPasswordResetLink);

    // O antigo `status` da sessão: a confirmação do envio, até o próximo pedido.
    const [status, setStatus] = useState<string | null>(null);

    return (
        <>
            {status && (
                <div
                    role="status"
                    className="mb-5 animate-pop rounded-lg bg-success/12 px-3.5 py-2.5 text-sm font-medium text-success"
                >
                    {status}
                </div>
            )}

            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    form.submit({
                        onSuccess: (data) => setStatus(data.status),
                        onError: () => setStatus(null),
                    });
                }}
                className="space-y-5"
            >
                <Field label="E-mail" error={form.errors.email} hint={hint}>
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
        </>
    );
}
