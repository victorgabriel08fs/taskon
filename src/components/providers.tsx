'use client';

import { createContext, use, useEffect, type ReactNode } from 'react';
import { Toaster } from 'sonner';
import { FlashToaster } from '@/components/flash-toaster';
import { initializeTheme } from '@/hooks/use-appearance';
import { releasePomodoro } from '@/lib/pomodoro';
import type { AuthUser } from '@/types';

/**
 * O que no Inertia eram as props compartilhadas (`auth.user`) e o boot do
 * `app.tsx`: usuário logado, toasts e tema.
 *
 * O usuário vem do layout raiz, que é re-renderizado pelo servidor depois de
 * login, logout e de toda action que chama `refresh()` — então o contexto nunca
 * fica com a pessoa errada.
 */
const CurrentUserContext = createContext<AuthUser | null>(null);

export function Providers({ user, children }: { user: AuthUser | null; children: ReactNode }) {
    useEffect(() => {
        // Escuta a troca de tema do sistema; o tema inicial já veio no SSR.
        initializeTheme();
    }, []);

    useEffect(() => {
        // O cronômetro vive num módulo, fora do React: sem isto ele seguiria
        // contando depois do logout — o título da aba na tela pública e, no
        // fim da fase, um toast com o título de um card de quadro privado na
        // frente de quem estiver na máquina.
        if (!user) releasePomodoro();
    }, [user]);

    return (
        <CurrentUserContext value={user}>
            {children}
            <FlashToaster />
            <Toaster
                position="bottom-right"
                offset={20}
                toastOptions={{
                    className:
                        'rounded-xl! bg-surface! text-foreground! ring-1! ring-border! shadow-[var(--shadow-float)]!',
                }}
            />
        </CurrentUserContext>
    );
}

/** Quem está logado, ou null nas telas públicas. */
export function useCurrentUser(): AuthUser | null {
    return use(CurrentUserContext);
}

/** Quem está logado — para telas que só existem com sessão. */
export function useUser(): AuthUser {
    const user = use(CurrentUserContext);

    if (!user) throw new Error('useUser() chamado fora de uma tela autenticada.');

    return user;
}
