import type { Metadata } from 'next';
import { LoginForm } from '@/components/auth/login-form';
import { AuthLayout } from '@/components/layouts/auth-layout';
import { redirectIfAuthenticated, safeRedirectPath } from '@/server/auth/session';
import { flashedStatus } from '@/server/flash';

export const metadata: Metadata = {
    title: 'Entrar',
};

export default async function LoginPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    await redirectIfAuthenticated();

    // O destino que o proxy (ou o requireUser) anotou ao mandar a pessoa para cá.
    const { next } = await searchParams;

    // O antigo `session('status')`: a confirmação que a redefinição de senha
    // deixou (cookie de vida curta; o formulário o apaga depois de mostrar).
    const status = await flashedStatus();

    return (
        <AuthLayout title="Entrar" description="Bom te ver de novo. Seus quadros estão esperando.">
            <LoginForm next={typeof next === 'string' ? safeRedirectPath(next) : null} status={status} />
        </AuthLayout>
    );
}
