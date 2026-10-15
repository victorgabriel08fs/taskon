import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AdminActivation } from '@/components/admin/admin-activation';
import { AdminPanel } from '@/components/admin/admin-panel';
import { currentUser, requireUser } from '@/server/auth/session';
import { config } from '@/server/config';
import { HttpError } from '@/server/errors';
import { adminAccess } from '@/server/policies/admin';
import { loadAdminPanel } from '@/server/queries/admin';
import type { AdminPanelData } from '@/types';

/**
 * O título só existe para quem administra: para os outros a rota é um 404, e
 * uma aba chamada "Administração" contaria que há algo aqui.
 */
export async function generateMetadata(): Promise<Metadata> {
    const user = await currentUser();

    return user && adminAccess(user) !== null ? { title: 'Administração' } : {};
}

/**
 * A administração do Taskon. Sem `loading.tsx` de propósito: com ele, o
 * esqueleto do painel sairia no stream ANTES de a página decidir — e quem não
 * é admin veria um 200 com o painel "carregando" virar 404, justo o que esta
 * rota esconde. Sem ele o 404 é um 404 de verdade, e a barra de progresso
 * cobre a espera de quem chega pelo menu.
 */
export default async function AdminPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const user = await requireUser();
    const access = adminAccess(user);

    // 404, e não 403: para quem não administra, o painel não existe — um 403
    // confirmaria que há algo aqui.
    if (access === null) notFound();

    // E-mail nativo ainda não confirmado: só a tela que explica e manda o link.
    if (access === 'pending') return <AdminActivation expiresInMinutes={config.admin.emailVerificationMinutes} />;

    let data: AdminPanelData;

    try {
        // Busca, filtro e página crus da URL: o loader os normaliza (aparar,
        // filtro desconhecido → 'all', página fora da faixa → a mais próxima).
        data = await loadAdminPanel(user, await searchParams);
    } catch (error) {
        // O loader confere o acesso de novo (é a autorização de verdade).
        if (error instanceof HttpError && error.status === 404) notFound();

        throw error;
    }

    return <AdminPanel {...data} />;
}
