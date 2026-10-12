import type { Metadata } from 'next';
import { Welcome } from '@/components/auth/welcome';
import { config } from '@/server/config';

export const metadata: Metadata = {
    // O `title.template` ("%s · Taskon") do layout raiz só vale para os
    // segmentos FILHOS, não para a página do mesmo segmento: aqui o sufixo vai
    // à mão, para a aba continuar "… · Taskon" como no legado.
    title: { absolute: `Organize qualquer coisa, arrastando · ${config.appName}` },
};

/**
 * A página inicial. Aberta a todos: quem já entrou vê os botões apontando
 * para o painel (o usuário chega pelo contexto do layout raiz).
 */
export default function HomePage() {
    return <Welcome />;
}
