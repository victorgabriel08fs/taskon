import type { Metadata } from 'next';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';
import { AuthLayout } from '@/components/layouts/auth-layout';
import { redirectIfAuthenticated } from '@/server/auth/session';

export const metadata: Metadata = {
    title: 'Nova senha',
};

/**
 * O destino do link do e-mail. O token só é conferido no envio do formulário
 * (como no Laravel): um link vencido mostra o erro no campo de e-mail.
 */
export default async function ResetPasswordPage({
    params,
    searchParams,
}: {
    params: Promise<{ token: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    await redirectIfAuthenticated();

    const { token } = await params;
    const { email } = await searchParams;

    return (
        <AuthLayout title="Nova senha" description="Escolha uma senha que só você saiba.">
            <ResetPasswordForm token={token} email={typeof email === 'string' ? email : ''} />
        </AuthLayout>
    );
}
