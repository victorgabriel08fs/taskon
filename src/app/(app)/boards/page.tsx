import type { Metadata } from 'next';
import { BoardsIndex } from '@/components/boards/boards-index';
import { requireUser } from '@/server/auth/session';
import { loadBoardsIndex } from '@/server/queries/boards-index';

export const metadata: Metadata = { title: 'Meus quadros' };

export default async function BoardsPage() {
    const user = await requireUser();
    const { boards, backgrounds } = await loadBoardsIndex(user);

    return <BoardsIndex boards={boards} backgrounds={backgrounds} />;
}
