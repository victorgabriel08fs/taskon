import { Ban, Crown, Hourglass, ShieldCheck, type LucideIcon } from 'lucide-react';
import { TimeAgo } from '@/components/time-ago';
import { cn } from '@/lib/utils';
import type { AdminUserRow } from '@/types';

// Nos selos de tinta (a cor do selo diluída no fundo), o texto vai em
// `foreground` e a cor fica só no ícone: texto de 11 px na cor do selo, sobre
// a tinta da mesma cor, não chega aos 4,5:1 que o WCAG pede para texto pequeno
// — o roxo e o vermelho ficam perto de 4:1, e o amarelo bem abaixo disso.
const badge = 'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold';

interface RoleBadge {
    label: string;
    /** O porquê do selo, no title: "Aguardando confirmação" sozinho não diz de quê. */
    title: string;
    icon: LucideIcon;
    className: string;
}

const ROLE: Record<AdminUserRow['role'], RoleBadge | null> = {
    native: {
        label: 'Admin nativo',
        title: 'E-mail da lista de admins nativos, já confirmado: faz tudo no painel, e ninguém mexe nesta conta',
        icon: Crown,
        className: 'bg-primary text-primary-fg',
    },
    admin: {
        label: 'Admin',
        title: 'Admin concedido: bloqueia e desbloqueia contas comuns',
        icon: ShieldCheck,
        className: 'bg-primary-soft text-foreground [&>svg]:text-primary',
    },
    native_pending: {
        label: 'Aguardando confirmação',
        title: 'E-mail da lista de admins nativos, ainda não confirmado: a administração só liga depois que a pessoa confirmar',
        icon: Hourglass,
        className: 'bg-warning/15 text-foreground [&>svg]:text-warning',
    },
    user: null,
};

/**
 * Os selos de uma conta: "Você", o papel na administração e o bloqueio — este
 * com quem bloqueou (se a conta dessa pessoa ainda existe) e há quanto tempo.
 */
export function AccountBadges({ row, isViewer }: { row: AdminUserRow; isViewer: boolean }) {
    const role = ROLE[row.role];

    return (
        <>
            {isViewer && <span className={cn(badge, 'bg-surface-3 text-muted-fg')}>Você</span>}

            {role && (
                <span title={role.title} className={cn(badge, role.className)}>
                    <role.icon className="size-3" aria-hidden />
                    {role.label}
                </span>
            )}

            {row.blocked_at && (
                <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
                    <span className={cn(badge, 'bg-danger/12 text-foreground [&>svg]:text-danger')}>
                        <Ban className="size-3" aria-hidden />
                        Bloqueado
                    </span>
                    <span className="text-xs text-muted-fg">
                        {row.blocked_by && `por ${row.blocked_by} · `}
                        <TimeAgo iso={row.blocked_at} />
                    </span>
                </span>
            )}
        </>
    );
}
