import type { Metadata } from 'next';
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';
import { AuthLayout } from '@/components/layouts/auth-layout';
import { redirectIfAuthenticated } from '@/server/auth/session';
import { isProduction } from '@/server/config';
import { mailerName } from '@/server/mail/mailer';

export const metadata: Metadata = {
    title: 'Recuperar senha',
};

export default async function ForgotPasswordPage() {
    await redirectIfAuthenticated();

    // A dica do legado ("o e-mail cai em storage/logs/laravel.log"), só onde
    // ela é verdade: desenvolvimento sem serviço de e-mail, em que o mailer
    // `log` imprime a mensagem (com o link) no terminal do servidor.
    const hint =
        !isProduction && mailerName() === 'log'
            ? 'Em ambiente local o e-mail aparece no terminal do servidor.'
            : undefined;

    return (
        <AuthLayout title="Recuperar senha" description="Enviamos um link para você definir uma senha nova.">
            <ForgotPasswordForm hint={hint} />
        </AuthLayout>
    );
}
