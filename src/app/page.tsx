import type { Metadata } from 'next';
import { Welcome } from '@/components/auth/welcome';

export const metadata: Metadata = {
    title: 'Organize qualquer coisa, arrastando',
};

/**
 * A página inicial. Aberta a todos: quem já entrou vê os botões apontando
 * para o painel (o usuário chega pelo contexto do layout raiz).
 */
export default function HomePage() {
    return <Welcome />;
}
