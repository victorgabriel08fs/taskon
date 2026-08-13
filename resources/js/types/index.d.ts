import '@inertiajs/core';

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
    created_at: string;
    label_ids: number[];
    member_ids: number[];
    comments: Comment[];
    checklists: Checklist[];
    activities: Activity[];
}

export interface BoardList {
    id: number;
    title: string;
    position: number;
    card_limit: number | null;
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
    members: User[];
    labels: Label[];
    lists: BoardList[];
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

export interface SharedProps {
    name: string;
    auth: { user: User | null };
    appearance: Appearance;
    [key: string]: unknown;
}

export interface Toast {
    type: 'success' | 'error' | 'info';
    message: string;
}

declare module '@inertiajs/core' {
    interface InertiaConfig {
        sharedPageProps: SharedProps;
        flashDataType: { toast?: Toast };
    }
}
