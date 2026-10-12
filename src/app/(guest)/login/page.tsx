import type { Metadata } from 'next';
import { LoginForm } from '@/components/auth/login-form';
import { AuthLayout } from '@/components/layouts/auth-layout';
import { redirectIfAuthenticated, safeRedirectPath } from '@/server/auth/session';

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

    return (
        <AuthLayout title="Entrar" description="Bom te ver de novo. Seus quadros estão esperando.">
            <LoginForm next={typeof next === 'string' ? safeRedirectPath(next) : null} />
        </AuthLayout>
    );
}
