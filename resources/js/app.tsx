import '../css/app.css';

import { createInertiaApp, router, type ResolvedComponent } from '@inertiajs/react';
import { resolvePageComponent } from 'laravel-vite-plugin/inertia-helpers';
import { createRoot } from 'react-dom/client';
import { Toaster, toast } from 'sonner';

import { initializeTheme } from '@/hooks/use-appearance';
import { releasePomodoro } from '@/lib/pomodoro';

const appName = import.meta.env.VITE_APP_NAME || 'Taskon';

/**
 * O cronômetro vive num módulo, fora do React: sem isto ele seguiria contando
 * depois do logout — o título da aba contando na tela pública e, no fim da
 * fase, um toast com o título de um card de quadro privado na frente de quem
 * estiver na máquina.
 */
function releaseIfGuest(page: { props: { auth?: { user?: unknown } } }) {
    if (!page.props.auth?.user) releasePomodoro();
}

// Cada página vira um chunk próprio: o bundle inicial não carrega o quadro
// inteiro só para mostrar a tela de login.
const pages = import.meta.glob<{ default: ResolvedComponent }>('./pages/**/*.tsx');

// Antes de qualquer render: evita o flash de tema errado.
initializeTheme();

createInertiaApp({
    title: (title) => (title ? `${title} · ${appName}` : appName),

    resolve: async (name) => (await resolvePageComponent(`./pages/${name}.tsx`, pages)).default,

    setup({ el, App, props }) {
        // Máquina compartilhada: quem abre o navegador numa tela de visitante
        // não herda o ciclo de quem fechou a aba antes. Roda antes do render,
        // então o ticker morre no mesmo turno.
        releaseIfGuest(props.initialPage);

        createRoot(el).render(
            <>
                <App {...props} />
                <Toaster
                    position="bottom-right"
                    offset={20}
                    toastOptions={{
                        className:
                            'rounded-xl! bg-surface! text-foreground! ring-1! ring-border! shadow-[var(--shadow-float)]!',
                    }}
                />
            </>,
        );
    },

    progress: {
        color: 'oklch(66% 0.19 293)',
        delay: 120,
        showSpinner: false,
    },
});

/**
 * Mensagens do servidor viram toast. `flash` do Inertia v3 é efêmero de
 * verdade: não fica preso no histórico nem reaparece ao voltar de página.
 */
router.on('flash', (event) => {
    const payload = event.detail.flash.toast;

    if (!payload) return;

    const notify = payload.type === 'error' ? toast.error : payload.type === 'info' ? toast.info : toast.success;

    notify(payload.message);
});

/**
 * Fim de sessão. `success` (e não `navigate`) porque só resposta de servidor
 * conta: `navigate` também dispara ao voltar no histórico, com as props
 * antigas gravadas ali, e apagaria um ciclo válido. Cobre tanto o botão "Sair"
 * quanto a exclusão da conta — os dois redirecionam para uma página sem
 * `auth.user`.
 */
router.on('success', (event) => releaseIfGuest(event.detail.page));

router.on('httpException', (event) => {
    if (event.detail.response.status === 403) {
        toast.error('Você não tem permissão para fazer isso.');

        return false;
    }
});

router.on('networkError', () => {
    toast.error('Sem conexão com o servidor. Suas alterações locais não foram salvas.');

    return false;
});
