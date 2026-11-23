import type { Metadata } from 'next';
import { Welcome } from '@/components/auth/welcome';
import { config } from '@/server/config';

export const metadata: Metadata = {
    // O `title.template` ("%s · Raia") do layout raiz só vale para os
    // segmentos FILHOS: aqui o título vai inteiro, com o slogan da marca.
    title: { absolute: `${config.appName} · Cada tarefa na sua raia.` },
};

/**
 * A página inicial. Aberta a todos: quem já entrou vê os botões apontando
 * para o painel (o usuário chega pelo contexto do layout raiz).
 */
export default function HomePage() {
    return <Welcome />;
}
