import { CircleCheck, TriangleAlert } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthLayout } from '@/components/layouts/auth-layout';
import { VerifyEmailCard } from '@/components/verify-email/verify-email-card';
import { cn } from '@/lib/utils';
import { currentUser } from '@/server/auth/session';
import type { UserRow } from '@/server/db/schema';
import { adminAccess } from '@/server/policies/admin';
import { EMAIL_VERIFICATION_MESSAGES, previewEmailVerification } from '@/server/services/email-verification';

export const metadata: Metadata = {
    title: 'Confirmar e-mail',
    // O link é pessoal (é a prova de uma caixa de entrada): não tem por que
    // aparecer em buscador.
    robots: { index: false, follow: false },
};

/**
 * O link do e-mail de confirmação. Pública e fora do grupo (guest), como o
 * /invite: quem clica pode estar logado nesta conta, em outra ou em nenhuma —
 * o token é a prova, não a sessão. Abrir a página não confirma nada; o botão
 * confirma (ver VerifyEmailCard).
 */
export default async function VerifyEmailPage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    const [preview, user] = await Promise.all([previewEmailVerification(token), currentUser()]);

    if (!preview) {
        const dead = deadLink(user);

        return (
            <AuthLayout title="Link indisponível" description="Este link não leva mais a lugar nenhum.">
                <div className="space-y-5">
                    <p
                        className={cn(
                            'flex gap-2.5 rounded-lg px-3.5 py-3 text-sm text-foreground',
                            dead.settled ? 'bg-success/12' : 'bg-warning/12',
                        )}
                    >
                        {dead.settled ? (
                            <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                        ) : (
                            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                        )}
                        {/* `anywhere`, não `break-word`: só ele conta no min-content, e o
                            e-mail longo da mensagem alargaria a coluna para fora da tela. */}
                        <span className="min-w-0 wrap-anywhere">{dead.message}</span>
                    </p>
                    <Link
                        href={dead.href}
                        className="text-sm font-semibold text-primary underline-offset-4 hover:underline"
                    >
                        {dead.label}
                    </Link>
                </div>
            </AuthLayout>
        );
    }

    return (
        <AuthLayout title="Confirme seu e-mail" description="Falta um clique para provar que esta caixa de entrada é sua.">
            <VerifyEmailCard token={token} preview={preview} viewerEmail={user?.email ?? null} />
        </AuthLayout>
    );
}

/**
 * A mesma frase do toast de quando o link morre entre abrir a página e clicar.
 * Nesse caso o 404 da action re-renderiza esta página, que cai aqui.
 */
const EXPIRED = EMAIL_VERIFICATION_MESSAGES.invalid;

const EXPIRED_WITHOUT_RETRY = 'Este link de confirmação não vale mais — ele pode ter expirado, já ter sido usado ou o e-mail da conta mudou.';

/**
 * Para onde mandar quem abriu um link morto. O caso comum é clicar de novo
 * num e-mail antigo depois de já ter confirmado — aí não há nada a refazer, e
 * a tela diz isso em vez de soar como erro.
 */
function deadLink(user: UserRow | null): { settled: boolean; message: string; href: string; label: string } {
    // Sem sessão não dá para saber de quem é o link; o pedido de um novo sai
    // de dentro da conta (a tela de ativação do /admin).
    if (!user) return { settled: false, message: EXPIRED, href: '/login', label: 'Entrar' };

    const access = adminAccess(user);

    if (user.emailVerifiedAt) {
        return {
            settled: true,
            message: `Não faz falta: o e-mail da sua conta (${user.email}) já está confirmado.`,
            href: access === 'native' ? '/admin' : '/dashboard',
            label: access === 'native' ? 'Ir para a administração' : 'Ir para o painel',
        };
    }

    // E-mail nativo à espera da prova: o novo link sai da tela de ativação.
    if (access === 'pending') return { settled: false, message: EXPIRED, href: '/admin', label: 'Pedir um novo link' };

    // Conta sem e-mail nativo: não há link novo a pedir (a confirmação só
    // existe para ativar a administração), então a frase não manda pedir.
    return { settled: false, message: EXPIRED_WITHOUT_RETRY, href: '/dashboard', label: 'Ir para o painel' };
}
