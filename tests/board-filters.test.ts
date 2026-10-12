import { describe, expect, it } from 'vitest';
import { EMPTY_FILTERS, countActiveFilters, matchesFilters, type BoardFilters } from '@/components/board/filters';
import type { Card } from '@/types';

/**
 * Os filtros do quadro rodam no navegador, sobre o espelho local das listas —
 * nenhum vai ao servidor. Estes testes travam a regra de cada um.
 */

const ME = 7;

function card(overrides: Partial<Card> = {}): Card {
    return {
        id: 1,
        board_list_id: 1,
        title: 'Revisar contrato',
        position: 1,
        cover_color: null,
        due_at: null,
        completed_at: null,
        has_description: false,
        label_ids: [],
        member_ids: [],
        comments_count: 0,
        checklist_total: 0,
        checklist_done: 0,
        ...overrides,
    };
}

const filters = (overrides: Partial<BoardFilters>): BoardFilters => ({ ...EMPTY_FILTERS, ...overrides });

describe('filtros do quadro', () => {
    it('sem filtro, todo card aparece', () => {
        expect(matchesFilters(card(), EMPTY_FILTERS, ME)).toBe(true);
        expect(countActiveFilters(EMPTY_FILTERS)).toBe(0);
    });

    it('busca pelo título sem diferenciar maiúsculas', () => {
        expect(matchesFilters(card(), filters({ query: 'CONTRATO' }), ME)).toBe(true);
        expect(matchesFilters(card(), filters({ query: 'orçamento' }), ME)).toBe(false);
    });

    it('esconde os concluídos', () => {
        const done = card({ completed_at: '2026-10-12T10:00:00-03:00' });

        expect(matchesFilters(done, filters({ hideDone: true }), ME)).toBe(false);
        expect(matchesFilters(card(), filters({ hideDone: true }), ME)).toBe(true);
    });

    it('"só os meus" olha os responsáveis do card', () => {
        expect(matchesFilters(card({ member_ids: [ME] }), filters({ onlyMine: true }), ME)).toBe(true);
        expect(matchesFilters(card({ member_ids: [99] }), filters({ onlyMine: true }), ME)).toBe(false);
    });

    it('etiquetas e membros: basta uma das escolhidas', () => {
        const tagged = card({ label_ids: [3], member_ids: [4] });

        expect(matchesFilters(tagged, filters({ labelIds: [2, 3] }), ME)).toBe(true);
        expect(matchesFilters(tagged, filters({ labelIds: [2] }), ME)).toBe(false);
        expect(matchesFilters(tagged, filters({ memberIds: [4, 5] }), ME)).toBe(true);
        expect(matchesFilters(tagged, filters({ memberIds: [5] }), ME)).toBe(false);
    });

    it('filtros diferentes se somam (E), e cada escolha conta no selo', () => {
        const active = filters({ query: 'revisar', labelIds: [1, 2], memberIds: [3], onlyMine: true, hideDone: true });

        expect(countActiveFilters(active)).toBe(6);
        expect(matchesFilters(card({ label_ids: [1], member_ids: [3, ME] }), active, ME)).toBe(true);
        expect(matchesFilters(card({ label_ids: [1], member_ids: [3] }), active, ME)).toBe(false);
    });
});
