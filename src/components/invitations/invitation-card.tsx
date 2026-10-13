'use client';

import { LogIn, SquareKanban, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { TimeAgo } from '@/components/time-ago';
import { Button } from '@/components/ui/button';
import { runAction } from '@/lib/actions';
import { boardBackgroundClass } from '@/lib/palette';
import { cn } from '@/lib/utils';
import { acceptBoardInvitation } from '@/server/actions/invitations';
import type { InvitationPreview } from '@/types';

/** Os botões da tela de convite com o mesmo desenho do <Button> (que não vira link). */
const linkButton =
    'inline-flex h-12 w-full items-center justify-center gap-2.5 rounded-lg px-6 text-base font-medium ' +
    'transition-[transform,filter,background-color] duration-150 ease-out active:scale-[0.97]';

/**
 * O convite como quem abriu o link o vê: o quadro (com o fundo dele), quem
 * convidou, o papel e o prazo. Logado, um clique aceita; visitante escolhe
 * entre criar a conta (o convite vai junto) ou entrar com uma que já tem.
 */
export function InvitationCard({
    token,
    invitation,
    viewerEmail,
}: {
    token: string;
    invitation: InvitationPreview;
    /** E-mail de quem está logado, ou null para visitante. */
    viewerEmail: string | null;
}) {
    const [accepting, setAccepting] = useState(false);
    const role = invitation.role === 'admin' ? 'admin' : 'membro';
    const here = `/invite/${token}`;

    return (
        <div className="space-y-6">
            <div className={cn('overflow-hidden rounded-xl text-white shadow-[var(--shadow-card)]', boardBackgroundClass(invitation.board_background))}>
                <div className="flex items-center gap-3 bg-black/15 p-5">
                    <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-white/20 ring-1 ring-white/30">
                        <SquareKanban className="size-5" />
                    </span>
                    <div className="min-w-0">
                        <p className="truncate text-lg font-bold drop-shadow-sm">{invitation.board_title}</p>
                        <p className="text-sm text-white/85">
                            {invitation.invited_by ?? 'Alguém'} convidou você como {role}
                        </p>
                    </div>
                </div>
            </div>

            <p className="text-sm text-muted-fg">
                O convite foi enviado para <span className="font-medium text-foreground">{invitation.email}</span> e
                expira <TimeAgo iso={invitation.expires_at} />.
            </p>

            {viewerEmail ? (
                <div className="space-y-3">
                    {viewerEmail !== invitation.email && (
                        <p className="rounded-lg bg-warning/12 px-3.5 py-2.5 text-sm text-foreground">
                            Você vai entrar no quadro com a conta <span className="font-medium">{viewerEmail}</span>.
                        </p>
                    )}

                    <Button
                        size="lg"
                        className="w-full"
                        loading={accepting}
                        onClick={() => {
                            setAccepting(true);
                            void runAction(acceptBoardInvitation({ token }), { onFinish: () => setAccepting(false) });
                        }}
                    >
                        <UserPlus className="size-5" />
                        Entrar no quadro
                    </Button>
                </div>
            ) : (
                <div className="space-y-3">
                    <Link
                        href={`/register?invite=${encodeURIComponent(token)}`}
                        className={cn(linkButton, 'bg-primary text-primary-fg shadow-sm hover:brightness-110')}
                    >
                        <UserPlus className="size-5" />
                        Criar conta e entrar
                    </Link>

                    <Link
                        href={`/login?next=${encodeURIComponent(here)}`}
                        className={cn(linkButton, 'bg-surface-2 text-foreground ring-1 ring-border hover:bg-surface-3')}
                    >
                        <LogIn className="size-5" />
                        Já tenho conta
                    </Link>
                </div>
            )}
        </div>
    );
}
