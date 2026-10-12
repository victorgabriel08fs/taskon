import { useCallback, useSyncExternalStore } from 'react';
import type { Appearance } from '@/types';

const query = () => window.matchMedia('(prefers-color-scheme: dark)');

function read(): Appearance {
    try {
        const saved = localStorage.getItem('appearance');

        return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
    } catch {
        // Aba anônima com storage bloqueado: segue o sistema.
        return 'system';
    }
}

function apply(appearance: Appearance) {
    const isDark = appearance === 'dark' || (appearance === 'system' && query().matches);

    document.documentElement.classList.toggle('dark', isDark);
}

function persist(appearance: Appearance) {
    try {
        localStorage.setItem('appearance', appearance);
    } catch {
        // Sem storage o cookie abaixo ainda segura a escolha.
    }

    // Cookie legível pelo servidor: o layout raiz já renderiza no tema certo e
    // não há flash branco no primeiro paint.
    document.cookie = `appearance=${appearance};path=/;max-age=31536000;SameSite=Lax`;
}

let listening = false;

/**
 * Chamado uma vez no boot do app (Providers). O tema inicial já veio pronto do
 * servidor; aqui só se acompanha a troca de tema do sistema operacional.
 */
export function initializeTheme() {
    if (listening) return;

    listening = true;
    apply(read());

    query().addEventListener('change', () => {
        if (read() === 'system') apply('system');
    });
}

const CHANGE = 'taskon:appearance';

function subscribe(callback: () => void): () => void {
    window.addEventListener(CHANGE, callback);
    window.addEventListener('storage', callback);

    return () => {
        window.removeEventListener(CHANGE, callback);
        window.removeEventListener('storage', callback);
    };
}

/**
 * A preferência salva neste navegador. No SSR (e na hidratação) vale
 * `'system'`; logo depois o React relê o storage — sem flash, porque a classe
 * `dark` do <html> já veio certa do servidor pelo cookie.
 */
export function useAppearance() {
    const appearance = useSyncExternalStore<Appearance>(subscribe, read, () => 'system');

    const update = useCallback((value: Appearance) => {
        persist(value);
        apply(value);
        window.dispatchEvent(new Event(CHANGE));
    }, []);

    return { appearance, updateAppearance: update } as const;
}
