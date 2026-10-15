import { eq } from 'drizzle-orm';
import { refresh } from 'next/cache';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { toast as sonner } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminUserRow } from '@/types';
import { AccountActionButtons, useAccountActions, type AccountActions } from '@/components/admin/account-actions';
import {
    blockUser as blockUserAction,
    grantAdmin as grantAdminAction,
    revokeAdmin as revokeAdminAction,
    unblockUser as unblockUserAction,
} from '@/server/actions/admin';
import { startSession } from '@/server/auth/session';
import { config } from '@/server/config';
import { db } from '@/server/db';
import { adminEvents, users, type UserRow } from '@/server/db/schema';
import { loadAdminPanel } from '@/server/queries/admin';
import { ADMIN_MESSAGES, blockUser, grantAdmin, revokeAdmin, type AdminOperation } from '@/server/services/admin';
import { expectHttpError } from '../support/assertions';
import { createUser } from '../support/factories';

/**
 * Regressões da revisão do painel de administração (/admin):
 *
 *  1. A recusa por estado que mudou por baixo da tela não re-renderizava. O
 *     serviço decide pelo estado de AGORA — "já está bloqueado(a)" (422) quando
 *     outra aba ou outro admin chegou antes, "Só o admin nativo…" (403) quando
 *     o alvo acabou de virar admin, o 403 genérico quando quem clica perdeu o
 *     admin —, mas o `defineAction` só chama `refresh()` no sucesso e no 404.
 *     A linha ficava com o `can` velho: o mesmo botão, o mesmo erro a cada
 *     clique, até um F5. Agora as actions do painel re-renderizam também
 *     nessas recusas, e a página volta junto com o toast.
 *  2. Clique duplo no botão do diálogo de confirmação ("Bloquear", "Tirar
 *     admin") despachava a action duas vezes: o diálogo sai com animação, o
 *     botão continua clicável, e só o botão da linha conferia a ação em
 *     andamento. Saía o toast de sucesso e, logo depois, o vermelho "já está
 *     bloqueado(a)". Agora cada confirmação vale uma vez, e o `run` do hook não
 *     deixa duas ações na mesma conta.
 *  3. O nome acessível de "Tirar admin" era "Tirar o admin de Ana": não
 *     continha o texto visível (WCAG 2.5.3), e quem usa controle por voz diz o
 *     que vê.
 *
 * Os casos 2 e 3 são do navegador, mas não há jsdom (BOAS_PRATICAS, 9.5): o
 * hook roda num render de servidor só para entregar as funções que a tela
 * chamaria, e o diálogo é um dublê que devolve o `onConfirm` — o que o botão
 * dele chama a cada clique. As actions rodam de verdade, contra o banco, só
 * espionadas para contar quantas vezes a tela as despachou.
 */
const jar = vi.hoisted(() => {
    const store = new Map<string, string>();

    return {
        store,
        get: (name: string) => (store.has(name) ? { name, value: store.get(name)! } : undefined),
        has: (name: string) => store.has(name),
        set: (name: string, value: string) => {
            store.set(name, value);
        },
        delete: (name: string) => {
            store.delete(name);
        },
        getAll: () => [...store].map(([name, value]) => ({ name, value })),
    };
});

vi.mock('next/headers', () => ({
    cookies: async () => jar,
    headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.22', 'user-agent': 'vitest' }),
}));
vi.mock('next/cache', () => ({ refresh: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }));

vi.mock('@/server/actions/admin', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/server/actions/admin')>();

    return {
        grantAdmin: vi.fn(actual.grantAdmin),
        revokeAdmin: vi.fn(actual.revokeAdmin),
        blockUser: vi.fn(actual.blockUser),
        unblockUser: vi.fn(actual.unblockUser),
    };
});

/** O que a tela pediu ao diálogo de confirmação, na ordem. */
const confirmations = vi.hoisted(() => [] as { title: string; onConfirm: () => void }[]);

vi.mock('@/components/ui/confirm', () => ({
    useConfirm: () => ({
        confirm: (options: { title: string; onConfirm: () => void }) => {
            confirmations.push(options);
        },
        dialog: null,
    }),
}));

const NOW = new Date('2026-10-14T15:00:00Z');
const NATIVE_EMAIL = config.admin.nativeEmails[0]!;

const ACTIONS = {
    grant_admin: grantAdminAction,
    revoke_admin: revokeAdminAction,
    block: blockUserAction,
    unblock: unblockUserAction,
} as const satisfies Record<AdminOperation, unknown>;

beforeEach(() => {
    jar.store.clear();
    confirmations.length = 0;
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

function createNative(): Promise<UserRow> {
    return createUser({ name: 'Victor Nativo', email: NATIVE_EMAIL, emailVerifiedAt: NOW });
}

async function signIn(user: Pick<UserRow, 'id'>): Promise<void> {
    await startSession(user.id, false);
}

/** A conta como o banco a tem agora (o painel decide pelo acesso de agora). */
async function reload(user: Pick<UserRow, 'id'>): Promise<UserRow> {
    const [row] = await db.select().from(users).where(eq(users.id, user.id));

    return row!;
}

/** A linha de `target` como o painel de `viewer` a desenha. */
async function rowOf(viewer: Pick<UserRow, 'id'>, target: Pick<UserRow, 'id'>): Promise<AdminUserRow> {
    const { users: rows } = await loadAdminPanel(await reload(viewer), {});
    const row = rows.find((candidate) => candidate.id === target.id);

    if (!row) throw new Error(`a conta ${target.id} não está no painel`);

    return row;
}

/**
 * O hook do painel fora do navegador: um render de servidor só para pegar as
 * funções que a tela chamaria. Depois do render o `setState` é no-op; o que
 * conta aqui são os pedidos que saem, e esses as actions espionadas contam.
 */
function mountAccountActions(): AccountActions {
    let mounted: AccountActions | undefined;

    renderToStaticMarkup(
        createElement(HookProbe, {
            onRender: (actions: AccountActions) => {
                mounted = actions;
            },
        }),
    );

    if (!mounted) throw new Error('o hook não rodou');

    return mounted;
}

function HookProbe({ onRender }: { onRender: (actions: AccountActions) => void }) {
    onRender(useAccountActions());

    return null;
}

describe('a recusa porque a conta mudou por baixo da tela volta com a página atualizada', () => {
    interface Scene {
        native: UserRow;
        admin: UserRow;
        caio: UserRow;
    }

    const CASES: {
        scenario: string;
        /** O que outra aba ou outro admin fez depois que a tela foi desenhada. */
        meanwhile: (scene: Scene) => Promise<unknown>;
        who: 'native' | 'admin';
        operation: AdminOperation;
        status: 403 | 422;
        message: string;
    }[] = [
        {
            scenario: 'o nativo bloqueou Caio antes; o admin clica "Bloquear"',
            meanwhile: ({ native, caio }) => blockUser(native, caio.id),
            who: 'admin',
            operation: 'block',
            status: 422,
            message: 'Caio Comum já está bloqueado(a).',
        },
        {
            scenario: 'o nativo bloqueou Caio em outra aba; nesta, clica "Conceder admin"',
            meanwhile: ({ native, caio }) => blockUser(native, caio.id),
            who: 'native',
            operation: 'grant_admin',
            status: 422,
            message: 'Desbloqueie Caio Comum antes de conceder admin.',
        },
        {
            scenario: 'o nativo já concedeu admin a Caio em outra aba; nesta, concede de novo',
            meanwhile: ({ native, caio }) => grantAdmin(native, caio.id),
            who: 'native',
            operation: 'grant_admin',
            status: 422,
            message: 'Caio Comum já é admin.',
        },
        {
            scenario: 'Caio acabou de virar admin; o admin concedido clica "Bloquear"',
            meanwhile: ({ native, caio }) => grantAdmin(native, caio.id),
            who: 'admin',
            operation: 'block',
            status: 403,
            message: ADMIN_MESSAGES.nativeOnly.block,
        },
    ];

    it.each(CASES)('$scenario → $status', async ({ meanwhile, who, operation, status, message }) => {
        const scene: Scene = {
            native: await createNative(),
            admin: await createUser({ name: 'Ana Admin', isAdmin: true }),
            caio: await createUser({ name: 'Caio Comum' }),
        };
        const viewer = scene[who];

        // A tela foi desenhada com o botão — e só depois a conta mudou.
        expect((await rowOf(viewer, scene.caio)).can[operation]).toBe(true);

        await meanwhile(scene);
        await signIn(viewer);

        expect(await ACTIONS[operation]({ userId: scene.caio.id })).toEqual({
            ok: false,
            status,
            toast: { type: 'error', message },
        });
        expect(refresh).toHaveBeenCalledTimes(1);

        // E a página re-renderizada já não oferece o botão que falhou.
        expect((await rowOf(viewer, scene.caio)).can[operation]).toBe(false);
    });

    it('quem perdeu o admin com o painel aberto: 403, e a página re-renderizada é o 404', async () => {
        const native = await createNative();
        const admin = await createUser({ name: 'Ana Admin', isAdmin: true });
        const caio = await createUser({ name: 'Caio Comum' });

        expect((await rowOf(admin, caio)).can.block).toBe(true);

        await revokeAdmin(native, admin.id);
        await signIn(admin);

        expect(await blockUserAction({ userId: caio.id })).toEqual({
            ok: false,
            status: 403,
            toast: { type: 'error', message: 'Você não tem permissão para fazer isso.' },
        });
        expect(refresh).toHaveBeenCalledTimes(1);
        await expectHttpError(loadAdminPanel(await reload(admin), {}), 404);
        expect(await db.$count(adminEvents)).toBe(1);
    });
});

describe('clique duplo no botão do diálogo de confirmação', () => {
    beforeEach(() => {
        // O `runAction` avisa começo e fim no `window` (a barra de progresso).
        vi.stubGlobal('window', new EventTarget());
    });

    it.each([
        ['block', {}, 'Caio Comum foi bloqueado(a) — as sessões abertas caíram.'],
        ['revoke_admin', { isAdmin: true }, 'Caio Comum não é mais admin.'],
    ] as const)(
        '"%s" sai uma vez só — com o segundo clique antes e depois de a primeira ação voltar',
        async (operation, overrides, success) => {
            const native = await createNative();
            const caio = await createUser({ name: 'Caio Comum', ...overrides });

            await signIn(native);

            const actions = mountAccountActions();

            actions.request(await rowOf(native, caio), operation);

            expect(confirmations).toHaveLength(1);

            const [dialog] = confirmations;

            dialog!.onConfirm(); // o clique que confirma (e fecha o diálogo)
            dialog!.onConfirm(); // o segundo, no botão que ainda está saindo de cena

            expect(ACTIONS[operation]).toHaveBeenCalledTimes(1);

            await vi.waitFor(() => expect(sonner.success).toHaveBeenCalledWith(success));

            // A primeira já voltou, e o diálogo pode ainda estar saindo.
            dialog!.onConfirm();

            expect(ACTIONS[operation]).toHaveBeenCalledTimes(1);
            expect(sonner.error).not.toHaveBeenCalled();
            expect(await db.$count(adminEvents)).toBe(1);
        },
    );

    it('uma ação por conta de cada vez: a outra conta não espera, e a conta fica livre quando a ação volta', async () => {
        const native = await createNative();
        const caio = await createUser({ name: 'Caio Comum' });
        const bia = await createUser({ name: 'Bia Lima' });

        await signIn(native);

        const actions = mountAccountActions();
        const caioRow = await rowOf(native, caio);
        const biaRow = await rowOf(native, bia);

        actions.request(caioRow, 'grant_admin');
        actions.request(caioRow, 'grant_admin'); // a mesma conta, com a primeira ainda no ar
        actions.request(biaRow, 'grant_admin');

        expect(vi.mocked(grantAdminAction).mock.calls).toEqual([[{ userId: caio.id }], [{ userId: bia.id }]]);

        await vi.waitFor(() => expect(sonner.success).toHaveBeenCalledTimes(2));

        actions.request(await rowOf(native, caio), 'revoke_admin');
        confirmations.at(-1)!.onConfirm();

        expect(revokeAdminAction).toHaveBeenCalledTimes(1);

        await vi.waitFor(() => expect(sonner.success).toHaveBeenCalledWith('Caio Comum não é mais admin.'));

        expect(sonner.error).not.toHaveBeenCalled();
        expect(await db.$count(adminEvents)).toBe(3);
    });
});

describe('o nome acessível de cada botão começa com o texto visível (WCAG 2.5.3)', () => {
    it('inclusive "Tirar admin" — quem usa controle por voz diz o que vê', async () => {
        const native = await createNative();
        const ana = await createUser({ name: 'Ana Souza' });
        const beto = await createUser({ name: 'Beto Admin', isAdmin: true, blockedAt: NOW, blockedBy: native.id });
        const idle: Pick<AccountActions, 'request' | 'running'> = { request: () => {}, running: () => undefined };

        const buttonsOf = async (target: UserRow) => {
            const html = renderToStaticMarkup(
                createElement(AccountActionButtons, { row: await rowOf(native, target), actions: idle }),
            );

            return [...html.matchAll(/<button\b[^>]*\baria-label="([^"]*)"[^>]*>([\s\S]*?)<\/button>/g)].map(
                ([, name, content]) => ({ name: name!, text: content!.replace(/<[^>]*>/g, '') }),
            );
        };

        const buttons = [...(await buttonsOf(ana)), ...(await buttonsOf(beto))];

        // As quatro ações aparecem: conta comum (conceder, bloquear) e admin bloqueado (tirar, desbloquear).
        expect(buttons.map((button) => button.text)).toEqual(['Conceder admin', 'Bloquear', 'Tirar admin', 'Desbloquear']);
        expect(buttons[2]!.name).toBe('Tirar admin de Beto Admin');

        for (const { name, text } of buttons) {
            expect(name.startsWith(`${text} `), `"${name}" não começa com "${text}"`).toBe(true);
        }
    });
});
