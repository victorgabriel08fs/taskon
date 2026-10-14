
export type Appearance = 'light' | 'dark' | 'system';

export type ColorKey =
    | 'emerald'
    | 'amber'
    | 'orange'
    | 'rose'
    | 'violet'
    | 'blue'
    | 'sky'
    | 'lime'
    | 'pink'
    | 'slate';

export type AvatarColor = 'violet' | 'blue' | 'emerald' | 'amber' | 'rose' | 'cyan' | 'fuchsia' | 'teal';

export type BoardBackground =
    | 'aurora'
    | 'sunset'
    | 'ocean'
    | 'forest'
    | 'candy'
    | 'midnight'
    | 'ember'
    | 'graphite';

export type BoardRole = 'owner' | 'admin' | 'member';

export interface User {
    id: number;
    name: string;
    email: string;
    initials: string;
    avatar_color: AvatarColor;
    title: string | null;
    /** Presente apenas quando o usuário vem da relação de membros de um quadro. */
    role?: BoardRole;
}

export interface Label {
    id: number;
    name: string | null;
    color: ColorKey;
}

export interface Card {
    id: number;
    board_list_id: number;
    title: string;
    position: number;
    cover_color: ColorKey | null;
    due_at: string | null;
    completed_at: string | null;
    has_description: boolean;
    label_ids: number[];
    member_ids: number[];
    comments_count: number;
    checklist_total: number;
    checklist_done: number;
}

export interface ChecklistItem {
    id: number;
    content: string;
    is_done: boolean;
    position: number;
}

export interface Checklist {
    id: number;
    title: string;
    position: number;
    items: ChecklistItem[];
}

export interface Comment {
    id: number;
    body: string;
    created_at: string;
    author: User;
    can_delete: boolean;
}

export interface Activity {
    id: number;
    type: string;
    description: string;
    properties: Record<string, unknown> | null;
    created_at: string;
    user: User | null;
    /** Só vem no painel, onde o feed mistura quadros. */
    board?: { id: number; title: string; background: BoardBackground };
}

export interface CardDetail {
    id: number;
    board_id: number;
    board_list_id: number;
    list_title: string;
    title: string;
    description: string | null;
    cover_color: ColorKey | null;
    due_at: string | null;
    completed_at: string | null;
    /** Preenchido quando o card saiu do quadro — o deep link continua abrindo. */
    archived_at: string | null;
    created_at: string;
    label_ids: number[];
    member_ids: number[];
    comments: Comment[];
    checklists: Checklist[];
    activities: Activity[];
}

/**
 * O card visto da gaveta de arquivados. É de propósito mais magro que `Card`:
 * a lista pode ter cem linhas e só precisa do bastante para reconhecê-lo.
 */
export interface ArchivedCard {
    id: number;
    title: string;
    list_title: string | null;
    due_at: string | null;
    completed_at: string | null;
    archived_at: string | null;
}

/* -------------------------------------------------------------------------- */
/* Exportação                                                                  */
/* -------------------------------------------------------------------------- */

export interface ExportChecklistItem {
    content: string;
    is_done: boolean;
}

export interface ExportChecklist {
    title: string;
    items: ExportChecklistItem[];
}

export interface ExportComment {
    /** Nulo quando a conta do autor não existe mais. */
    author: string | null;
    body: string;
    created_at: string | null;
}

/**
 * O que o texto exportado precisa e o `Card` do Kanban não carrega. Vem por
 * `CardExportResource`, sob demanda, e é casado com o card pelo `id`.
 */
export interface CardExportDetail {
    id: number;
    description: string | null;
    checklists: ExportChecklist[];
    comments: ExportComment[];
}

export interface BoardList {
    id: number;
    title: string;
    position: number;
    card_limit: number | null;
    /** Soltar um card aqui marca `completed_at`; tirar de cá limpa. */
    is_done: boolean;
    cards: Card[];
}

export interface Board {
    id: number;
    title: string;
    description: string | null;
    background: BoardBackground;
    owner_id: number;
    is_favorite: boolean;
    role: BoardRole | null;
    can: { manage: boolean; delete: boolean };
    /** Dias entre concluir o card e ele sair da coluna. `null` = desligado. */
    auto_archive_days: number | null;
    /** Quantos cards estão na gaveta — inclui os arquivados na mão. */
    archived_count: number;
    members: User[];
    /** Convites ainda não aceitos. Só vem preenchido para quem administra o quadro. */
    invitations: BoardInvitation[];
    labels: Label[];
    lists: BoardList[];
}

/** Convite por e-mail para quem ainda não tem conta (ver src/server/services/invitations.ts). */
export interface BoardInvitation {
    id: number;
    email: string;
    role: 'admin' | 'member';
    /** Nome de quem convidou, ou null se a conta dela não existe mais. */
    invited_by: string | null;
    created_at: string;
    expires_at: string;
}

/** O convite como a página /invite/[token] o mostra para quem o recebeu. */
export interface InvitationPreview {
    board_title: string;
    board_background: BoardBackground;
    email: string;
    role: 'admin' | 'member';
    invited_by: string | null;
    expires_at: string;
}

export interface BoardSummary {
    id: number;
    title: string;
    description: string | null;
    background: BoardBackground;
    is_favorite: boolean;
    role: BoardRole;
    last_opened_at: string | null;
    lists_count: number;
    cards_count: number;
    done_count: number;
    members: User[];
}

/* -------------------------------------------------------------------------- */
/* Painel                                                                      */
/* -------------------------------------------------------------------------- */

/** Um card visto de fora do quadro — a lista de prazos mistura vários. */
export interface Deadline {
    id: number;
    title: string;
    due_at: string | null;
    completed_at: string | null;
    board_id: number;
    board_title: string;
    board_background: BoardBackground;
    list_title: string;
}

export interface BoardProgress {
    id: number;
    title: string;
    background: BoardBackground;
    total: number;
    done: number;
    overdue: number;
}

/** Escala "minhas tarefas": só cards atribuídos ao usuário. */
export interface DashboardStats {
    open: number;
    overdue: number;
    today: number;
    upcoming: number;
    completed_week: number;
    completed_previous_week: number;
    boards: number;
}

/** As fatias do anel. Somadas dão o total de tarefas abertas. */
export interface DueBreakdown {
    overdue: number;
    today: number;
    upcoming: number;
    later: number;
    none: number;
}

/** Um dia do gráfico de ritmo. Dias parados vêm com zero, não faltando. */
export interface TrendPoint {
    date: string;
    created: number;
    completed: number;
}

/** Arquivamento automático, como a tela do quadro o recebe do servidor. */
export interface AutoArchiveConfig {
    /** Horário da varredura ("03:00"), no fuso do app. */
    at: string;
    /** Prazos oferecidos, em dias. Ausência de prazo (null) significa desligado. */
    options: number[];
}

/* -------------------------------------------------------------------------- */
/* Sessão e respostas                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Quem está logado, como o navegador enxerga. É o antigo `auth.user` das props
 * compartilhadas do Inertia: só o necessário para cabeçalho, avatar e filtros.
 */
export interface AuthUser {
    id: number;
    name: string;
    email: string;
    initials: string;
    avatar_color: AvatarColor;
    title: string | null;
    email_verified_at: string | null;
    /** Acesso à administração do Taskon (o painel /admin). */
    admin: AdminAccess;
}

/**
 * Quanto a pessoa manda na administração do Taskon — NÃO é o papel dela num
 * quadro (BoardRole):
 *  - 'native'  → admin nativo (e-mail da lista, já confirmado): tudo, e ninguém mexe nele;
 *  - 'admin'   → admin concedido: bloqueia e desbloqueia contas comuns;
 *  - 'pending' → e-mail da lista ainda não confirmado: o painel só oferece a confirmação;
 *  - null      → conta comum.
 */
export type AdminAccess = 'native' | 'admin' | 'pending' | null;

/* -------------------------------------------------------------------------- */
/* Administração                                                               */
/* -------------------------------------------------------------------------- */

export type AdminFilter = 'all' | 'admins' | 'blocked';

/** Uma conta na lista do painel de administração. */
export interface AdminUserRow {
    id: number;
    name: string;
    email: string;
    initials: string;
    avatar_color: AvatarColor;
    created_at: string;
    /** Última atividade numa sessão ainda guardada, ou null. */
    last_seen_at: string | null;
    boards_count: number;
    email_verified: boolean;
    /** 'native_pending' = e-mail da lista de admins nativos, ainda não confirmado. */
    role: 'native' | 'native_pending' | 'admin' | 'user';
    blocked_at: string | null;
    /** Nome de quem bloqueou (null se a conta dessa pessoa não existe mais). */
    blocked_by: string | null;
    /** O que QUEM ESTÁ VENDO pode fazer com esta conta — o servidor confere de novo. */
    can: { grant_admin: boolean; revoke_admin: boolean; block: boolean; unblock: boolean };
}

export interface AdminEvent {
    id: number;
    type: 'admin.granted' | 'admin.revoked' | 'user.blocked' | 'user.unblocked' | 'admin.activated';
    /** Quem fez (null se a conta não existe mais). */
    actor: string | null;
    target_name: string;
    target_email: string;
    created_at: string;
}

export interface AdminStats {
    users: number;
    /** Admins ativos: nativos confirmados + concedidos (sem contar bloqueados). */
    admins: number;
    blocked: number;
    new_this_week: number;
    boards: number;
    cards: number;
}

export interface AdminPanelData {
    viewer: { access: 'native' | 'admin' };
    stats: AdminStats;
    users: AdminUserRow[];
    pagination: { page: number; per_page: number; total: number; pages: number };
    filters: { q: string; filter: AdminFilter };
    events: AdminEvent[];
}

/** O que a página /verify-email/[token] mostra antes de confirmar. */
export interface EmailVerificationPreview {
    email: string;
    name: string;
}

export interface Toast {
    type: 'success' | 'error' | 'info';
    message: string;
}

/** Erros de validação por campo — a primeira mensagem de cada um. */
export type FieldErrors = Record<string, string>;

/**
 * O que toda Server Action devolve. Substitui o par "redirect back + flash" do
 * Laravel: a página atualizada chega na mesma resposta (via `refresh()`), e o
 * resto — dado, toast, erro de validação — vem aqui.
 */
export type ActionResult<T = null> =
    | { ok: true; data: T; toast?: Toast }
    | {
          ok: false;
          /** 401 sessão expirada · 403 sem permissão · 404 sumiu · 422 validação · 429 limite · 500 falha. */
          status: 401 | 403 | 404 | 422 | 429 | 500;
          errors?: FieldErrors;
          toast?: Toast;
      };
