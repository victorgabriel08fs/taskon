import { AppLayout } from '@/components/layouts/app-layout';

/**
 * Enquanto o servidor monta o painel, a navegação já troca de tela: cabeçalho
 * de verdade e o esqueleto da grade no lugar dos números (o Inertia segurava a
 * tela antiga com a barra de progresso; aqui a resposta é imediata).
 */
export default function DashboardLoading() {
    return (
        <AppLayout>
            <div className="mx-auto w-full max-w-6xl px-5 py-8" aria-busy="true" aria-label="Carregando o painel">
                <div className="flex flex-wrap items-end justify-between gap-4">
                    <div className="space-y-2">
                        <span className="block h-7 w-56 animate-pulse rounded-lg bg-surface-3" />
                        <span className="block h-4 w-72 animate-pulse rounded-md bg-surface-3" />
                    </div>
                    <span className="block h-10 w-36 animate-pulse rounded-lg bg-surface-3" />
                </div>

                <span className="mb-4 mt-9 block h-4 w-40 animate-pulse rounded-md bg-surface-3" />

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {Array.from({ length: 4 }).map((_, index) => (
                        <div key={index} className="h-[8.5rem] animate-pulse rounded-xl bg-surface ring-1 ring-border" />
                    ))}
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_24rem]">
                    <div className="h-72 animate-pulse rounded-xl bg-surface ring-1 ring-border" />
                    <div className="h-72 animate-pulse rounded-xl bg-surface ring-1 ring-border" />
                </div>
            </div>
        </AppLayout>
    );
}
