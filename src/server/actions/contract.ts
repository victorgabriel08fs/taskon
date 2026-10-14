/**
 * O CONTRATO das Server Actions — a lista do que o navegador pode pedir ao
 * servidor, com a entrada e a saída de cada pedido. É o equivalente às rotas
 * de routes/web.php + routes/auth.php + routes/settings.php do Laravel.
 *
 * Cada action implementada declara `satisfies XxxActions['nome']`, então
 * implementação e telas não conseguem divergir sem o TypeScript reclamar.
 *
 * Convenções dos campos:
 *  - ids do ALVO (o que era parâmetro de URL no Laravel) em camelCase:
 *    `boardId`, `listId`, `cardId`, `labelId`, `userId`, `commentId`,
 *    `checklistId`, `itemId`;
 *  - os demais campos com o MESMO nome do corpo da requisição no Laravel
 *    (snake_case): `due_at`, `cover_color`, `ordered_ids`, `board_list_id`…
 *    — assim as chaves de erro de validação continuam as mesmas que as telas
 *    já mostram (`errors.password_confirmation`).
 *
 * "redirect" = a action termina em `redirect()` com o aviso num cookie de
 * flash (ver src/server/flash.ts); no sucesso a Promise não traz dado útil.
 */
import type {
    ActionResult,
    ArchivedCard,
    AvatarColor,
    BoardBackground,
    CardExportDetail,
    ColorKey,
} from '@/types';

type Action<Input, Output = null> = (input: Input) => Promise<ActionResult<Output>>;
type NoInput<Output = null> = (input: void) => Promise<ActionResult<Output>>;

/* -------------------------------------------------------------------------- */
/* Autenticação (src/server/actions/auth.ts)                                   */
/* -------------------------------------------------------------------------- */

export interface AuthActions {
    /** Guest. 5 tentativas por e-mail+IP; erro em `email`. redirect → `next` seguro ou /dashboard. */
    login: Action<{ email: string; password: string; remember: boolean; next?: string | null }>;
    /** Guest. Cria a conta + quadro de exemplo, loga. redirect → /dashboard. */
    register: Action<{
        name: string;
        email: string;
        password: string;
        password_confirmation: string;
        /** Token de convite (/register?invite=…): aceito logo depois de criar a conta. */
        invite?: string | null;
    }>;
    /** Guest. Devolve a mensagem de status para a tela ("Enviamos o link…"). Erro em `email`. */
    sendPasswordResetLink: Action<{ email: string }, { status: string }>;
    /** Guest. Troca a senha pelo token. redirect → /login (flash). Erro em `email`/`password`. */
    resetPassword: Action<{ token: string; email: string; password: string; password_confirmation: string }>;
    /** Qualquer um. Encerra a sessão. redirect → /. */
    logout: NoInput;
}

/* -------------------------------------------------------------------------- */
/* Configurações (src/server/actions/settings.ts)                              */
/* -------------------------------------------------------------------------- */

export interface SettingsActions {
    updateProfile: Action<{ name: string; email: string; title: string | null; avatar_color: AvatarColor }>;
    /** Throttle 6/min por usuário. */
    updatePassword: Action<{ current_password: string; password: string; password_confirmation: string }>;
    /** Exige a senha atual. redirect → /. */
    deleteAccount: Action<{ password: string }>;
}

/* -------------------------------------------------------------------------- */
/* Notificações (src/server/actions/notifications.ts)                          */
/* -------------------------------------------------------------------------- */

export interface NotificationActions {
    updateDigestPreference: Action<{ daily_digest: boolean }>;
    /** Throttle 3/min por usuário. Manda o resumo de agora para a própria pessoa. */
    sendTestDigest: NoInput;
}

/* -------------------------------------------------------------------------- */
/* Quadros (src/server/actions/boards.ts)                                      */
/* -------------------------------------------------------------------------- */

export interface BoardActions {
    /** redirect → /boards/{id} (flash "Quadro criado."). */
    createBoard: Action<{ title: string; background: BoardBackground }>;
    /** manage. Só os campos enviados mudam; `auto_archive_done_after_days: null` desliga. */
    updateBoard: Action<{
        boardId: number;
        title?: string;
        description?: string | null;
        background?: BoardBackground;
        auto_archive_done_after_days?: number | null;
    }>;
    /** delete (só o dono). redirect → /boards (flash "Quadro excluído."). */
    deleteBoard: Action<{ boardId: number }>;
    /** view. Favorito é por pessoa. */
    toggleFavorite: Action<{ boardId: number }>;
    /**
     * manage. Conta existente entra na hora; sem conta, recebe convite por
     * e-mail (ver InvitationActions). Erros em `email`.
     */
    addBoardMember: Action<{ boardId: number; email: string; role: 'admin' | 'member' }>;
    /** manage. O dono não sai (erro em toast). */
    removeBoardMember: Action<{ boardId: number; userId: number }>;
}

/* -------------------------------------------------------------------------- */
/* Convites (src/server/actions/invitations.ts)                                */
/* -------------------------------------------------------------------------- */

export interface InvitationActions {
    /** manage. Token e prazo novos; o link anterior para de valer. */
    resendBoardInvitation: Action<{ invitationId: number }>;
    /** manage. O link para de valer na hora. */
    revokeBoardInvitation: Action<{ invitationId: number }>;
    /** Qualquer pessoa logada com o link. redirect → /boards/{id} (flash). */
    acceptBoardInvitation: Action<{ token: string }>;
}

/* -------------------------------------------------------------------------- */
/* Listas (src/server/actions/lists.ts)                                        */
/* -------------------------------------------------------------------------- */

export interface ListActions {
    createList: Action<{ boardId: number; title: string }>;
    updateList: Action<{ listId: number; title?: string; card_limit?: number | null; is_done?: boolean }>;
    deleteList: Action<{ listId: number }>;
    /** A ordem final inteira; ids de outros quadros são ignorados. */
    reorderLists: Action<{ boardId: number; ordered_ids: number[] }>;
}

/* -------------------------------------------------------------------------- */
/* Cards (src/server/actions/cards.ts)                                         */
/* -------------------------------------------------------------------------- */

export interface CardActions {
    /** Entra no fim da lista; quem cria já vira responsável. */
    createCard: Action<{ listId: number; title: string }, { id: number }>;
    /** Só os campos enviados mudam. `due_at` no formato do datetime-local (fuso do app) ou null. */
    updateCard: Action<{
        cardId: number;
        title?: string;
        description?: string | null;
        cover_color?: ColorKey | null;
        due_at?: string | null;
        is_completed?: boolean;
    }>;
    /** redirect → /boards/{boardId} (flash '"Título" foi excluído.'). */
    deleteCard: Action<{ cardId: number }>;
    /** A ordem final da lista de destino; cruzar a coluna de conclusão conclui/reabre. */
    moveCard: Action<{ cardId: number; board_list_id: number; ordered_ids: number[] }>;
    toggleCardLabel: Action<{ cardId: number; labelId: number }>;
    toggleCardMember: Action<{ cardId: number; userId: number }>;
}

/* -------------------------------------------------------------------------- */
/* Arquivamento (src/server/actions/archive.ts)                                */
/* -------------------------------------------------------------------------- */

export interface ArchiveActions {
    /** update. redirect → /boards/{boardId} (flash '"Título" foi para Arquivados, no menu do quadro.'). */
    archiveCard: Action<{ cardId: number }>;
    /** update. 404 se não está arquivado. Reabre, devolve à primeira coluna comum e devolve a gaveta atualizada. */
    restoreCard: Action<{ cardId: number }, ArchivedCard[]>;
    /** manage. Roda agora a varredura do agendador; devolve a gaveta atualizada. */
    archiveDoneCards: Action<{ boardId: number }, ArchivedCard[]>;
    /** view. Leitura da gaveta de arquivados (não re-renderiza a página). */
    loadArchivedCards: Action<{ boardId: number }, ArchivedCard[]>;
}

/* -------------------------------------------------------------------------- */
/* Exportação (src/server/actions/export.ts)                                   */
/* -------------------------------------------------------------------------- */

export interface ExportActions {
    /** view. Descrição, checklists e comentários de todos os cards vivos (não re-renderiza a página). */
    loadExportDetails: Action<{ boardId: number }, CardExportDetail[]>;
}

/* -------------------------------------------------------------------------- */
/* Comentários, checklists e etiquetas (src/server/actions/card-content.ts)    */
/* -------------------------------------------------------------------------- */

export interface CardContentActions {
    addComment: Action<{ cardId: number; body: string }>;
    /** Só o autor apaga (403 para os outros). */
    deleteComment: Action<{ commentId: number }>;
    addChecklist: Action<{ cardId: number; title: string }>;
    deleteChecklist: Action<{ checklistId: number }>;
    addChecklistItem: Action<{ checklistId: number; content: string }>;
    updateChecklistItem: Action<{ itemId: number; content?: string; is_done?: boolean }>;
    deleteChecklistItem: Action<{ itemId: number }>;
    /** manage. */
    createLabel: Action<{ boardId: number; name: string | null; color: ColorKey }>;
    /** manage. */
    updateLabel: Action<{ labelId: number; name?: string | null; color?: ColorKey }>;
    /** manage. */
    deleteLabel: Action<{ labelId: number }>;
}

/* -------------------------------------------------------------------------- */
/* Administração (src/server/actions/admin.ts)                                 */
/* -------------------------------------------------------------------------- */

/**
 * Toda action aqui exige acesso de admin ATIVO (src/server/policies/admin.ts)
 * e confere a hierarquia de novo no servidor: 403 com toast quando a regra não
 * deixa. Todas re-renderizam a página (refresh) no sucesso.
 */
export interface AdminActions {
    /** Só o admin nativo. */
    grantAdmin: Action<{ userId: number }>;
    /** Só o admin nativo. */
    revokeAdmin: Action<{ userId: number }>;
    /** Derruba todas as sessões da conta na hora. */
    blockUser: Action<{ userId: number }>;
    unblockUser: Action<{ userId: number }>;
}

/* -------------------------------------------------------------------------- */
/* Confirmação de e-mail (src/server/actions/email-verification.ts)            */
/* -------------------------------------------------------------------------- */

export interface EmailVerificationActions {
    /** Logado. Manda o link de confirmação para o e-mail da conta (throttle). */
    requestEmailVerification: NoInput;
    /**
     * Qualquer um com o link (o token prova a caixa de entrada). redirect →
     * /admin se a conta virou admin nativo, /dashboard se há sessão, /login
     * sem sessão — com aviso (flash).
     */
    confirmEmail: Action<{ token: string }>;
}
