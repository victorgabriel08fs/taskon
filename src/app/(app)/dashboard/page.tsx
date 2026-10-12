import type { Metadata } from 'next';
import { Dashboard } from '@/components/dashboard/dashboard';
import { requireUser } from '@/server/auth/session';
import { loadDashboard, loadDashboardActivity } from '@/server/queries/dashboard';

export const metadata: Metadata = { title: 'Painel' };

/**
 * Números, gráficos e prazos. É a tela de pouso depois do login.
 */
export default async function DashboardPage() {
    const user = await requireUser();
    const data = await loadDashboard(user);

    // O feed é o pedaço mais caro e o menos urgente: sai depois da primeira
    // pintura. A Promise vai sem `await` e o painel a lê dentro de um
    // <Suspense> — o HTML chega primeiro, o feed chega no mesmo stream.
    // Falhar o feed não pode derrubar o painel inteiro: vira null e o
    // quadrinho avisa sozinho.
    const activity = loadDashboardActivity(user).catch((error: unknown) => {
        console.error('[dashboard] falha ao carregar a atividade', error);

        return null;
    });

    return <Dashboard {...data} activity={activity} />;
}
