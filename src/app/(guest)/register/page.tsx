import type { Metadata } from 'next';
import { RegisterForm } from '@/components/auth/register-form';
import { AuthLayout } from '@/components/layouts/auth-layout';
import { redirectIfAuthenticated } from '@/server/auth/session';

export const metadata: Metadata = {
    title: 'Criar conta',
};

export default async function RegisterPage() {
    await redirectIfAuthenticated();

    return (
        <AuthLayout title="Criar conta" description="Leva 20 segundos e já vem com um quadro pronto.">
            <RegisterForm />
        </AuthLayout>
    );
}
