import { TriangleAlert } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { InvitationCard } from '@/components/invitations/invitation-card';
import { AuthLayout } from '@/components/layouts/auth-layout';
import { currentUser } from '@/server/auth/session';
import { INVITATION_MESSAGES, previewInvitation } from '@/server/services/invitations';

export const metadata: Metadata = {
    title: 'Convite para um quadro',
    // O link é pessoal: não tem por que aparecer em buscador.
    robots: { index: false, follow: false },
};

/**
 * O link do e-mail de convite. Aberta por visitante ou por quem já está
 * logado — por isso fica fora do grupo (guest) e do proxy: o convite em si é
 * a credencial, e aceitar exige sessão (a action manda para o login).
 */
export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    const [invitation, user] = await Promise.all([previewInvitation(token), currentUser()]);

    if (!invitation) {
        return (
            <AuthLayout title="Convite indisponível" description="Este link não leva mais a lugar nenhum.">
                <div className="space-y-5">
                    <p className="flex gap-2.5 rounded-lg bg-warning/12 px-3.5 py-3 text-sm text-foreground">
                        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
                        {INVITATION_MESSAGES.invalid}
                    </p>
                    <Link
                        href={user ? '/boards' : '/'}
                        className="text-sm font-semibold text-primary underline-offset-4 hover:underline"
                    >
                        {user ? 'Ir para os meus quadros' : 'Conhecer o Taskon'}
                    </Link>
                </div>
            </AuthLayout>
        );
    }

    return (
        <AuthLayout title="Você foi convidado" description="Entre no quadro e comece a organizar junto.">
            <InvitationCard token={token} invitation={invitation} viewerEmail={user?.email ?? null} />
        </AuthLayout>
    );
}
