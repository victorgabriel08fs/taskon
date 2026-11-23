import { RaiaLoader } from '@/components/brand';

/**
 * Lista de quadros ou um quadro carregando: o loader da marca no meio da
 * tela. Fica neste nível (e não em [boardId]) para abrir e fechar card, que
 * troca só a rota filha do quadro, não cair aqui.
 */
export default function BoardsLoading() {
    return (
        <div className="grid min-h-dvh place-items-center bg-background" aria-busy="true">
            <RaiaLoader label="Carregando" />
        </div>
    );
}
