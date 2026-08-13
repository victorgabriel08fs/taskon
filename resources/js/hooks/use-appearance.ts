import { useCallback, useEffect, useState } from 'react';
import type { Appearance } from '@/types';

const query = () => window.matchMedia('(prefers-color-scheme: dark)');

function apply(appearance: Appearance) {
    const isDark = appearance === 'dark' || (appearance === 'system' && query().matches);

    document.documentElement.classList.toggle('dark', isDark);
}

function persist(appearance: Appearance) {
    localStorage.setItem('appearance', appearance);
    // Cookie (não criptografado, ver bootstrap/app.php) para o Blade já renderizar
    // no tema certo e evitar o flash branco no primeiro paint.
    document.cookie = `appearance=${appearance};path=/;max-age=31536000;SameSite=Lax`;
}

/**
 * Chamado uma vez no boot da aplicação, antes do React montar.
 */
export function initializeTheme() {
    const saved = (localStorage.getItem('appearance') as Appearance | null) ?? 'system';

    apply(saved);

    query().addEventListener('change', () => {
        const current = (localStorage.getItem('appearance') as Appearance | null) ?? 'system';

        if (current === 'system') {
            apply('system');
        }
    });
}

export function useAppearance() {
    const [appearance, setAppearance] = useState<Appearance>('system');

    useEffect(() => {
        setAppearance((localStorage.getItem('appearance') as Appearance | null) ?? 'system');
    }, []);

    const update = useCallback((value: Appearance) => {
        setAppearance(value);
        persist(value);
        apply(value);
    }, []);

    return { appearance, updateAppearance: update } as const;
}
