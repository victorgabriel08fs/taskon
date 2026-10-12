import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    DEFAULT_EXPORT_OPTIONS,
    buildSprints,
    collectTasks,
    exportFileName,
    renderExport,
    type ExportOptions,
} from '@/lib/task-export';
import type { Board, BoardList, Card } from '@/types';

/*
 * Os testes rodam com o processo em UTC e o app em America/Sao_Paulo (ver
 * vitest.config.ts) — exatamente o desencontro entre o servidor da Vercel (ou
 * o navegador de alguém em outro fuso) e o fuso do app. Toda virada de dia da
 * exportação tem de seguir o fuso do app, como o `dueState` do quadro.
 */

function card(id: number, dueAt: string | null, listId = 1): Card {
    return {
        id,
        board_list_id: listId,
        title: `Tarefa ${id}`,
        position: id,
        cover_color: null,
        due_at: dueAt,
        completed_at: null,
        has_description: false,
        label_ids: [],
        member_ids: [],
        comments_count: 0,
        checklist_total: 0,
        checklist_done: 0,
    };
}

function board(cards: Card[]): Board {
    const list: BoardList = { id: 1, title: 'A fazer', position: 1, card_limit: null, is_done: false, cards };

    return {
        id: 7,
        title: 'Lançamento Ágil',
        description: null,
        background: 'aurora',
        owner_id: 1,
        is_favorite: false,
        role: 'owner',
        can: { manage: true, delete: true },
        auto_archive_days: null,
        archived_count: 0,
        members: [],
        labels: [],
        lists: [list],
    };
}

function sprintsOf(target: Board, options: Partial<ExportOptions> = {}) {
    const merged = { ...DEFAULT_EXPORT_OPTIONS, mode: 'due' as const, ...options };
    const selected = new Set(target.lists.flatMap((list) => list.cards.map((item) => item.id)));
    const tasks = collectTasks(target.lists, selected, new Map());

    return { sprints: buildSprints(tasks, merged, { names: [], assignment: {} }), options: merged };
}

afterEach(() => {
    vi.useRealTimers();
});

describe('exportação por prazo, no fuso do app', () => {
    it('põe o prazo de domingo à noite na semana que o quadro mostra', () => {
        // Domingo 18/10 às 23:30 em São Paulo — já é segunda (19/10) em UTC.
        const target = board([card(1, '2026-10-18T23:30:00-03:00'), card(2, '2026-10-12T09:00:00-03:00')]);
        const { sprints } = sprintsOf(target);

        expect(sprints).toHaveLength(1);
        expect(sprints[0]?.name).toBe('Sprint 1 — 12/10/2026 a 18/10/2026');
        expect(sprints[0]?.tasks.map((task) => task.card.id)).toEqual([2, 1]);
    });

    it('abre outra janela na segunda-feira seguinte, à meia-noite do fuso do app', () => {
        const target = board([card(1, '2026-10-18T23:59:00-03:00'), card(2, '2026-10-19T00:00:00-03:00')]);
        const { sprints } = sprintsOf(target);

        expect(sprints.map((sprint) => sprint.name)).toEqual([
            'Sprint 1 — 12/10/2026 a 18/10/2026',
            'Sprint 2 — 19/10/2026 a 25/10/2026',
        ]);
    });

    it('conta as semanas em dias de calendário e deixa os sem prazo no fim', () => {
        const target = board([
            card(1, '2026-10-14T10:00:00-03:00'),
            card(2, null),
            card(3, '2026-10-24T10:00:00-03:00'),
        ]);
        const { sprints } = sprintsOf(target, { weeks: 2 });

        expect(sprints.map((sprint) => [sprint.name, sprint.tasks.map((task) => task.card.id)])).toEqual([
            ['Sprint 1 — 12/10/2026 a 25/10/2026', [1, 3]],
            ['Sem prazo', [2]],
        ]);
    });

    it('escreve o dia do prazo do fuso do app no texto e no JSON', () => {
        // Mesmo vindo em UTC, o prazo é o domingo 18/10 de quem usa o quadro.
        const target = board([card(1, '2026-10-19T02:30:00Z')]);
        const { sprints, options } = sprintsOf(target, { mode: 'list' });

        expect(renderExport(sprints, target, options)).toContain('- Prazo: 18/10/2026');

        const json = JSON.parse(renderExport(sprints, target, { ...options, format: 'json' })) as {
            sprints: { tarefas: { prazo: string | null }[] }[];
        };

        expect(json.sprints[0]?.tarefas[0]?.prazo).toBe('2026-10-18');
    });
});

describe('nome do arquivo', () => {
    it('usa o dia de hoje no fuso do app, não o de UTC', () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        // 22:00 de 12/10 em São Paulo; em UTC já é dia 13.
        vi.setSystemTime(new Date('2026-10-13T01:00:00Z'));

        expect(exportFileName(board([]), 'markdown')).toBe('lancamento-agil-sprints-2026-10-12.md');
    });
});
