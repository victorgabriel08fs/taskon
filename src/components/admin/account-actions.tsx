'use client';

import { Ban, Loader2, LockOpen, ShieldMinus, ShieldPlus, type LucideIcon } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { runAction } from '@/lib/actions';
import { cn } from '@/lib/utils';
import { blockUser, grantAdmin, revokeAdmin, unblockUser } from '@/server/actions/admin';
import type { AdminActions } from '@/server/actions/contract';
import type { AdminUserRow } from '@/types';

/** O que dá para fazer com uma conta — as chaves de `row.can`. */
export type AccountAction = keyof AdminUserRow['can'];

interface ActionSpec {
    label: string;
    /**
     * O nome acessível diz em quem: "Bloquear" repetido 25 vezes não diz nada ao
     * leitor de tela. E começa com o `label`, palavra por palavra (WCAG 2.5.3):
     * quem usa controle por voz diz o que vê, "clicar Tirar admin" — e o
     * comando não acharia um botão chamado "Tirar o admin de Ana".
     */
    labelFor: (name: string) => string;
    icon: LucideIcon;
    danger?: boolean;
    call: AdminActions[keyof AdminActions];
}

const ACTIONS: Record<AccountAction, ActionSpec> = {
    grant_admin: {
        label: 'Conceder admin',
        labelFor: (name) => `Conceder admin a ${name}`,
        icon: ShieldPlus,
        call: grantAdmin,
    },
    revoke_admin: {
        label: 'Tirar admin',
        labelFor: (name) => `Tirar admin de ${name}`,
        icon: ShieldMinus,
        call: revokeAdmin,
    },
    block: {
        label: 'Bloquear',
        labelFor: (name) => `Bloquear ${name}`,
        icon: Ban,
        danger: true,
        call: blockUser,
    },
    unblock: {
        label: 'Desbloquear',
        labelFor: (name) => `Desbloquear ${name}`,
        icon: LockOpen,
        call: unblockUser,
    },
};

export interface AccountActions {
    /** Pede a ação; as que tiram acesso passam antes pela confirmação. */
    request: (row: AdminUserRow, action: AccountAction) => void;
    /** A ação em andamento numa conta, se houver. */
    running: (userId: number) => AccountAction | undefined;
    /** A confirmação: renderize uma vez, no painel, e não uma por linha. */
    dialog: ReactNode;
}

/**
 * As ações do painel sobre as contas. O toast de sucesso ou de recusa vem do
 * servidor (o `runAction` o mostra), e a página volta atualizada na mesma
 * resposta: selos, botões e números já chegam com o estado novo. Na recusa
 * também — ela quase sempre quer dizer que outra aba ou outro admin mudou a
 * conta depois que a página foi desenhada, e a linha volta como está agora.
 */
export function useAccountActions(): AccountActions {
    const { confirm, dialog } = useConfirm();
    const [running, setRunning] = useState<ReadonlyMap<number, AccountAction>>(() => new Map());
    // O mesmo que `running`, mas visto por qualquer render: o botão do diálogo
    // que ainda está saindo de cena chama o `run` do render em que o diálogo
    // abriu, cujo `running` é o de antes do clique.
    const inFlight = useRef(new Set<number>());

    const run = (row: AdminUserRow, action: AccountAction) => {
        // Uma ação por conta de cada vez, venha o pedido de onde vier: a
        // segunda sairia com o estado velho da tela e voltaria recusada.
        if (inFlight.current.has(row.id)) return;

        inFlight.current.add(row.id);
        setRunning((current) => new Map(current).set(row.id, action));

        void runAction(() => ACTIONS[action].call({ userId: row.id }), {
            onFinish: () => {
                inFlight.current.delete(row.id);
                setRunning((current) => {
                    const next = new Map(current);

                    next.delete(row.id);

                    return next;
                });
            },
        });
    };

    const request = (row: AdminUserRow, action: AccountAction) => {
        if (action === 'block') {
            confirm({
                title: `Bloquear ${row.name}?`,
                description:
                    'A pessoa não consegue mais entrar e as sessões abertas caem agora. Quadros e cards continuam ' +
                    'onde estão, e dá para desbloquear depois.' +
                    // Bloquear não tira o admin (spec): fica registrado, só não entra.
                    (row.role === 'admin' ? ' Ela continua admin, mas sem acesso enquanto estiver bloqueada.' : ''),
                confirmLabel: 'Bloquear',
                onConfirm: once(() => run(row, action)),
            });

            return;
        }

        if (action === 'revoke_admin') {
            confirm({
                title: `Tirar o admin de ${row.name}?`,
                description:
                    'A pessoa perde o painel de administração na hora. A conta, os quadros e as sessões dela ' +
                    'continuam como estão.',
                confirmLabel: 'Tirar admin',
                onConfirm: once(() => run(row, action)),
            });

            return;
        }

        run(row, action);
    };

    return { request, running: (userId) => running.get(userId), dialog };
}

/**
 * Uma confirmação, um pedido. O diálogo fecha com animação, e o botão dele
 * continua clicável enquanto sai de cena: o segundo clique de um clique duplo
 * cai no mesmo `onConfirm` — às vezes já depois de a primeira ação ter voltado,
 * quando a trava de `run` não segura mais — e mostraria o toast de "já está
 * bloqueado(a)" logo depois do de sucesso.
 */
function once(callback: () => void): () => void {
    let called = false;

    return () => {
        if (called) return;

        called = true;
        callback();
    };
}

/**
 * Os botões de uma conta — só os que `row.can` deixa; esconder não protege
 * nada, o servidor confere a hierarquia de novo.
 *
 * Dois lugares fixos (admin e bloqueio) em vez de uma lista: ao alternar
 * "Bloquear" → "Desbloquear", o botão continua sendo o mesmo nó, e o foco do
 * teclado não se perde quando a página volta atualizada. Pelo mesmo motivo a
 * espera é `aria-disabled`, não `disabled`: botão desabilitado perde o foco.
 */
export function AccountActionButtons({
    row,
    actions,
    className,
}: {
    row: AdminUserRow;
    actions: Pick<AccountActions, 'request' | 'running'>;
    className?: string;
}) {
    const slots = [
        { slot: 'admin', action: row.can.grant_admin ? 'grant_admin' : row.can.revoke_admin ? 'revoke_admin' : null },
        { slot: 'block', action: row.can.block ? 'block' : row.can.unblock ? 'unblock' : null },
    ] as const satisfies readonly { slot: string; action: AccountAction | null }[];

    const visible = slots.flatMap(({ slot, action }) => (action ? [{ slot, action }] : []));
    const running = actions.running(row.id);

    if (visible.length === 0) return null;

    return (
        <div className={cn('flex flex-wrap gap-2', className)}>
            {visible.map(({ slot, action }) => {
                const spec = ACTIONS[action];
                const busy = running !== undefined;

                return (
                    <Button
                        key={slot}
                        type="button"
                        size="sm"
                        variant="outline"
                        aria-label={spec.labelFor(row.name)}
                        aria-disabled={busy || undefined}
                        aria-busy={running === action || undefined}
                        // Com uma ação em andamento na conta, nem abre a
                        // confirmação: o `run` recusaria o pedido de todo jeito.
                        onClick={() => {
                            if (!busy) actions.request(row, action);
                        }}
                        className={cn(
                            'aria-disabled:cursor-wait aria-disabled:opacity-60',
                            spec.danger && 'text-danger ring-danger/30 hover:bg-danger/10',
                        )}
                    >
                        {running === action ? (
                            <Loader2 className="size-3.5 animate-spin" aria-hidden />
                        ) : (
                            <spec.icon className="size-3.5" aria-hidden />
                        )}
                        {spec.label}
                    </Button>
                );
            })}
        </div>
    );
}
