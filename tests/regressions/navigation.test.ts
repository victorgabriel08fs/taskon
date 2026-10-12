import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    initialProgress,
    isBusy,
    progressReducer,
    type ProgressEvent,
    type ProgressState,
} from '@/components/navigation-progress';
import { ACTION_END_EVENT, ACTION_START_EVENT, runAction } from '@/lib/actions';
import type { ActionResult } from '@/types';

/**
 * Regressões da barra de progresso do topo:
 *
 *  1. no Voltar/Avançar ela ficava presa ~10 s: no 'popstate' a URL JÁ é a do
 *     destino, e a navegação gravava esse pathname como "de onde saiu" — a
 *     troca de rota nunca era vista. A origem agora é o pathname commitado;
 *  2. as Server Actions não davam sinal nenhum (o Inertia mostrava a barra em
 *     todo POST/PATCH/DELETE, salvo `showProgress: false`): o `runAction`
 *     avisa começo e fim, sempre aos pares, e a barra conta as pendentes.
 *
 * O reducer é puro: os eventos do navegador viram ações, e aqui elas são
 * aplicadas na ordem em que o navegador as entregaria.
 */

vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }));

function run(state: ProgressState, ...events: ProgressEvent[]): ProgressState {
    return events.reduce(progressReducer, state);
}

describe('barra de progresso: navegação', () => {
    it('Voltar termina quando a rota de destino chega, mesmo com a URL trocada antes do popstate', () => {
        // O card aberto; o Voltar troca a URL para o quadro e SÓ ENTÃO dispara o popstate.
        const start = initialProgress('/boards/1/cards/5');
        const pending = run(start, { type: 'navigate', to: '/boards/1' });

        expect(pending.navigation?.from).toBe('/boards/1/cards/5');
        expect(isBusy(pending)).toBe(true);

        const done = run(pending, { type: 'commit', pathname: '/boards/1' });

        expect(isBusy(done)).toBe(false);
        expect(done.navigation).toBeNull();
    });

    it('navegação rápida (cache do roteador) não mostra barra: o commit vem antes dos 120 ms', () => {
        const state = run(
            initialProgress('/boards'),
            { type: 'navigate', to: '/boards/1' },
            { type: 'commit', pathname: '/boards/1' },
            // O timer dos 120 ms venceu entre o commit e o cleanup do effect.
            { type: 'reveal' },
        );

        expect(state.visible).toBe(false);
    });

    it('navegação lenta aparece aos 120 ms e some depois da animação de conclusão', () => {
        const shown = run(initialProgress('/boards'), { type: 'navigate', to: '/boards/1' }, { type: 'reveal' });

        expect(shown.visible).toBe(true);

        const finished = run(shown, { type: 'commit', pathname: '/boards/1' });

        // Ainda na tela, agora como "concluída" — até a animação acabar.
        expect(finished.visible).toBe(true);
        expect(isBusy(finished)).toBe(false);
        expect(run(finished, { type: 'hidden' }).visible).toBe(false);
    });

    it('destino com o mesmo pathname (âncora, query, Voltar de um #hash) não liga a barra', () => {
        const start = initialProgress('/boards/1');

        expect(run(start, { type: 'navigate', to: '/boards/1' })).toBe(start);
    });

    it('sem destino conhecido (router.push avisado sem href) começa assim mesmo', () => {
        const state = run(initialProgress('/boards/1'), { type: 'navigate' });

        expect(isBusy(state)).toBe(true);
    });

    it('desistir de uma navegação não derruba a seguinte', () => {
        const first = run(initialProgress('/a'), { type: 'navigate', to: '/b' });
        const firstId = first.navigation!.id;
        const second = run(first, { type: 'navigate', to: '/c' });

        expect(run(second, { type: 'give-up', id: firstId }).navigation).not.toBeNull();
        expect(run(second, { type: 'give-up', id: second.navigation!.id }).navigation).toBeNull();
    });
});

describe('barra de progresso: actions', () => {
    it('conta as actions pendentes e só conclui quando a última responde', () => {
        const busy = run(initialProgress('/boards/1'), { type: 'action-start' }, { type: 'action-start' }, { type: 'reveal' });

        expect(busy.visible).toBe(true);

        const one = run(busy, { type: 'action-end' });

        expect(isBusy(one)).toBe(true);
        expect(run(one, { type: 'hidden' }).visible).toBe(true);

        const none = run(one, { type: 'action-end' });

        expect(isBusy(none)).toBe(false);
        expect(run(none, { type: 'hidden' }).visible).toBe(false);
    });

    it('um fim sem começo não deixa a conta negativa (a próxima action ainda liga a barra)', () => {
        const state = run(initialProgress('/'), { type: 'action-end' }, { type: 'action-start' });

        expect(state.actions).toBe(1);
        expect(isBusy(state)).toBe(true);
    });

    it('navegação e action se sobrepõem sem prender a barra', () => {
        const both = run(
            initialProgress('/boards/1'),
            { type: 'action-start' },
            { type: 'navigate', to: '/boards/1/cards/5' },
            { type: 'reveal' },
        );

        // A rota chegou, mas a action ainda não: continua.
        const routed = run(both, { type: 'commit', pathname: '/boards/1/cards/5' });

        expect(isBusy(routed)).toBe(true);

        const idle = run(routed, { type: 'action-end' }, { type: 'hidden' });

        expect(isBusy(idle)).toBe(false);
        expect(idle.visible).toBe(false);
    });
});

describe('runAction avisa começo e fim, aos pares', () => {
    const events: string[] = [];

    beforeEach(() => {
        events.length = 0;

        const target = new EventTarget();

        for (const name of [ACTION_START_EVENT, ACTION_END_EVENT]) {
            target.addEventListener(name, () => events.push(name));
        }

        vi.stubGlobal('window', target);
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('o começo sai antes de a action ser despachada', async () => {
        const result = await runAction(async (): Promise<ActionResult> => {
            events.push('despachou');

            return { ok: true, data: null };
        });

        expect(result?.ok).toBe(true);
        expect(events).toEqual([ACTION_START_EVENT, 'despachou', ACTION_END_EVENT]);
    });

    it('a action que redireciona (Promise rejeitada com NEXT_REDIRECT) também fecha o par', async () => {
        const redirect = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;push;/boards;303;' });

        expect(await runAction(Promise.reject<ActionResult>(redirect))).toBeNull();
        expect(events).toEqual([ACTION_START_EVENT, ACTION_END_EVENT]);
    });

    it('queda de rede e falha 4xx também fecham o par', async () => {
        await runAction(Promise.reject<ActionResult>(new TypeError('Failed to fetch')));
        await runAction(Promise.resolve<ActionResult>({ ok: false, status: 403 }));

        expect(events).toEqual([ACTION_START_EVENT, ACTION_END_EVENT, ACTION_START_EVENT, ACTION_END_EVENT]);
    });

    it('progress: false (o arraste) não liga a barra', async () => {
        await runAction(Promise.resolve<ActionResult>({ ok: true, data: null }), { progress: false });

        expect(events).toEqual([]);
    });
});
