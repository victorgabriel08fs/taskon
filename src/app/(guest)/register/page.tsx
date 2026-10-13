import type { Metadata } from 'next';
import { RegisterForm } from '@/components/auth/register-form';
import { AuthLayout } from '@/components/layouts/auth-layout';
import { redirectIfAuthenticated } from '@/server/auth/session';
import { previewInvitation } from '@/server/services/invitations';

export const metadata: Metadata = {
    title: 'Criar conta',
};

export default async function RegisterPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    await redirectIfAuthenticated();

    // Veio do link de um convite: o formulário já sabe o e-mail e o quadro, e
    // a conta nasce lá dentro. Convite que não vale mais vira cadastro comum.
    const { invite } = await searchParams;
    const token = typeof invite === 'string' ? invite : null;
    const invitation = token ? await previewInvitation(token) : null;

    return (
        <AuthLayout title="Criar conta" description="Leva 20 segundos e já vem com um quadro pronto.">
            <RegisterForm
                invite={invitation && token ? { token, email: invitation.email, boardTitle: invitation.board_title } : null}
            />
        </AuthLayout>
    );
}
