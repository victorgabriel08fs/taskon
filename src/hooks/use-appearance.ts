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

    // Cookie legível pelo servidor: o layout raiz o injeta no script inline do
    // <head>, que aplica o tema antes do primeiro paint — sem flash branco.
    document.cookie = `appearance=${appearance};path=/;max-age=31536000;SameSite=Lax`;
}

let listening = false;

/**
 * Chamado uma vez no boot do app (Providers). O tema inicial já foi aplicado
 * pelo script inline do layout raiz; aqui se acompanha o que muda depois.
 *
 * A classe `dark` do <html> é só nossa (do script e de `apply`): o React não
 * renderiza `className` no <html>, então um refresh() da raiz não a apaga.
 */
export function initializeTheme() {
    if (listening) return;

    listening = true;
    apply(read());

    // Troca de tema do sistema operacional, para quem está em "Sistema".
    query().addEventListener('change', () => {
        if (read() === 'system') apply('system');
    });

    // Troca de tema em OUTRA aba: o seletor já acompanha (o `storage` também
    // alimenta o useSyncExternalStore abaixo), e a página tem de ir junto.
    // `key === null` é o localStorage.clear() — volta a seguir o sistema.
    window.addEventListener('storage', (event) => {
        if (event.key === 'appearance' || event.key === null) apply(read());
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
 * `dark` do <html> já foi posta antes do primeiro paint pelo script inline do
 * layout raiz, a partir do cookie.
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
