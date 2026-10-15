import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '@/server/config';
import { loadAdminPanel } from '@/server/queries/admin';
import { createUser } from '../support/factories';

/**
 * Revisão (lente: testes) — a busca e a página vêm crus da URL: nada que um
 * link colado (ou forjado) traga pode derrubar o painel com 500.
 */
vi.mock('next/cache', () => ({ refresh: vi.fn() }));

const NOW = new Date('2026-10-14T15:00:00Z');
const NATIVE_EMAIL = config.admin.nativeEmails[0]!;

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
});

afterEach(() => {
    vi.useRealTimers();
});

describe('entradas cruas da URL', () => {
    it('busca com surrogate solto, só controle ou só curingas não derruba o painel', async () => {
        const native = await createUser({ email: NATIVE_EMAIL, emailVerifiedAt: NOW });

        await createUser({ name: 'Ana' });

        for (const q of ['\uD800', '\uDFFFana', '\u0000\u0001', '%%%', '___', '\\\\', ' '.repeat(500), 'a'.repeat(10_000)]) {
            const panel = await loadAdminPanel(native, { q });

            expect(panel.pagination.page, JSON.stringify(q.slice(0, 10))).toBe(1);
        }
    });

    it('página e filtro em formatos estranhos caem no padrão', async () => {
        const native = await createUser({ email: NATIVE_EMAIL, emailVerifiedAt: NOW });

        for (const page of [Number.NaN, Number.POSITIVE_INFINITY, -0, 2.5, '+2', '0x2', '２', [] as string[]]) {
            expect((await loadAdminPanel(native, { page })).pagination.page, String(page)).toBe(1);
        }

        for (const filter of ['ADMINS', ' blocked', 'blocked ', [] as string[], null]) {
            expect((await loadAdminPanel(native, { filter })).filters.filter, String(filter)).toBe('all');
        }
    });
});
