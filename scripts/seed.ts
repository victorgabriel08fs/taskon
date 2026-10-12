/**
 * O `php artisan db:seed` (o antigo DatabaseSeeder): duas contas de
 * demonstração, dois quadros de exemplo e duas semanas de histórico para o
 * painel ter o que mostrar.
 *
 *     npm run db:seed     # banco já migrado, ainda sem as contas de demo
 *     npm run db:fresh    # apaga tudo, migra e semeia (scripts/fresh.ts)
 *
 * Recusa rodar com cara de produção (NODE_ENV=production ou VERCEL definido)
 * sem `--force`: as contas semeadas têm senha conhecida.
 */
import './_bootstrap';
import { basename } from 'node:path';
import { asc, eq, inArray } from 'drizzle-orm';
import { addAppDays, fromWallClock, wallClock } from '@/lib/timezone';
import type { Transaction } from '@/server/db';
import { boardLists, boardUser, cardUser, cards, users, type BoardListRow, type BoardRow, type UserRow } from '@/server/db/schema';

const DEMO_PASSWORD = 'password';
const VICTOR = 'victor@taskon.test';
const ANA = 'ana@taskon.test';

export const SEEDED_ACCOUNTS = `Usuários: ${VICTOR} / ${ANA} — senha: ${DEMO_PASSWORD}`;

/** Erro "esperado" do seed: sai como mensagem, sem pilha. */
export class SeedError extends Error {}

/**
 * Trava contra semear (ou apagar) o banco de produção por engano. `vercel env
 * pull` traz VERCEL=1 para o .env.local — e, junto, muitas vezes a URL do
 * banco de produção. Daí a trava também olhar o VERCEL.
 */
export function refuseInProduction(command: string): void {
    const looksLikeProduction = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);

    if (looksLikeProduction && !process.argv.includes('--force')) {
        console.error(
            `✗ ${command} recusado: o ambiente parece produção (NODE_ENV=production ou VERCEL definido).\n` +
                `  As contas de demonstração têm senha conhecida ("${DEMO_PASSWORD}"). Se é isso mesmo, rode de novo com --force.`,
        );
        process.exit(1);
    }
}

/**
 * Semeia o banco. Tudo numa transação: um seed que quebra no meio não deixa
 * meio banco para trás.
 *
 * Os módulos que abrem o banco entram por import dinâmico — a trava de
 * produção roda antes de qualquer conexão (ou de o PGlite criar o diretório).
 */
export async function seedDatabase(now = new Date()): Promise<void> {
    const { db } = await import('@/server/db');
    const { hashPassword } = await import('@/server/auth/password');
    const { buildDemoBoard } = await import('@/server/services/demo-board');

    const existing = await db.select({ email: users.email }).from(users).where(inArray(users.email, [VICTOR, ANA]));

    if (existing.length > 0) {
        throw new SeedError(
            `O banco já tem as contas de demonstração (${existing.map((row) => row.email).join(', ')}). ` +
                'Para recomeçar do zero: npm run db:fresh',
        );
    }

    const password = await hashPassword(DEMO_PASSWORD);

    await db.transaction(async (tx) => {
        // O `User::factory()`: e-mail já verificado; resumo diário ligado (padrão da coluna).
        const [victor] = await tx
            .insert(users)
            .values({
                name: 'Victor',
                email: VICTOR,
                title: 'Product Owner',
                avatarColor: 'violet',
                password,
                emailVerifiedAt: now,
            })
            .returning();

        const [ana] = await tx
            .insert(users)
            .values({
                name: 'Ana Souza',
                email: ANA,
                title: 'Designer',
                avatarColor: 'rose',
                password,
                emailVerifiedAt: now,
            })
            .returning();

        const launch = await buildDemoBoard(victor, 'Lançamento do Taskon', tx);

        await tx.insert(boardUser).values({ boardId: launch.id, userId: ana.id, role: 'admin' });

        await buildDemoBoard(victor, 'Pessoal', tx);

        await paintHistory(tx, launch, victor, ana, now);
    });
}

/**
 * Espalha cards pelas últimas duas semanas.
 *
 * Sem isso o painel abre com tudo criado hoje: o gráfico de ritmo vira uma
 * linha reta no zero com um pico no fim, e o anel de prazos não tem
 * vencidas. É dado de demonstração, mas precisa demonstrar alguma coisa.
 *
 * As datas são fixas de propósito — seed com sorteio dá um painel diferente
 * a cada `npm run db:fresh`, e aí não dá para comparar nada.
 */
async function paintHistory(tx: Transaction, board: BoardRow, victor: UserRow, ana: UserRow, now: Date): Promise<void> {
    const lists = await tx
        .select()
        .from(boardLists)
        .where(eq(boardLists.boardId, board.id))
        .orderBy(asc(boardLists.position));

    const list = (title: string): BoardListRow => {
        const found = lists.find((candidate) => candidate.title === title);

        if (!found) throw new Error(`A coluna "${title}" não existe no quadro "${board.title}".`);

        return found;
    };

    const done = list('Concluído');
    const doing = list('Em andamento');
    const todo = list('A fazer');

    /** O `now()->subDays($dias)->setTime($hora, $minuto)` — no fuso do app. */
    const daysAgo = (days: number, hour: number, minute = 0): Date => {
        const day = wallClock(addAppDays(now, -days));

        return fromWallClock(day.year, day.month, day.day, hour, minute);
    };

    // [título, dias atrás em que foi criado, dias atrás em que concluiu, dono]
    const concluidos: [string, number, number, UserRow][] = [
        ['Definir a paleta do tema escuro', 13, 11, ana],
        ['Fechar o contrato dos resources', 12, 11, victor],
        ['Escrever as policies do quadro', 11, 9, victor],
        ['Revisar o contraste dos botões', 9, 8, ana],
        ['Publicar a página inicial', 8, 6, victor],
        ['Ajustar o arrastar no celular', 6, 5, ana],
        ['Trocar os ícones do cabeçalho', 5, 4, victor],
        ['Cortar o flash do tema no F5', 4, 2, victor],
        ['Subir o Mailpit central', 2, 1, victor],
    ];

    // O incêndio: sem nada vencido, metade do painel fica sem graça e o
    // e-mail diário nunca mostra o estado que ele existe para mostrar.
    // [título, dias atrás em que foi criado, dias atrás em que venceu]
    const atrasados: [string, number, number][] = [
        ['Renovar o certificado de tasks.localhost', 3, 1],
        ['Responder o feedback da Ana no protótipo', 6, 2],
    ];

    const rows = [
        ...concluidos.map(([title, criado, concluido, dono], index) =>
            card(done, title, dono, index + 10, {
                createdAt: daysAgo(criado, 9, 30),
                completedAt: daysAgo(concluido, 17),
            }),
        ),
        ...atrasados.map(([title, criado, venceu], index) =>
            card(todo, title, victor, index + 20, {
                createdAt: daysAgo(criado, 11),
                dueAt: daysAgo(venceu, 18),
            }),
        ),
        card(doing, 'Fechar o relatório da sprint', victor, 30, {
            createdAt: daysAgo(2, 14),
            dueAt: daysAgo(0, 18),
        }),
    ];

    const created = await tx.insert(cards).values(rows).returning({ id: cards.id, createdBy: cards.createdBy });

    // Quem criou cada card também é o responsável por ele.
    await tx.insert(cardUser).values(created.map((row) => ({ cardId: row.id, userId: row.createdBy ?? victor.id })));
}

/**
 * Um card de histórico. `createdAt` explícito vence o padrão: o Drizzle só
 * carimba a data quando a coluna não vem no insert (o `updated_at` sai com
 * agora, como no Eloquent).
 */
function card(
    list: BoardListRow,
    title: string,
    owner: UserRow,
    position: number,
    attributes: Pick<typeof cards.$inferInsert, 'createdAt' | 'completedAt' | 'dueAt'>,
): typeof cards.$inferInsert {
    return {
        boardId: list.boardId,
        boardListId: list.id,
        createdBy: owner.id,
        title,
        position,
        ...attributes,
    };
}

async function main(): Promise<void> {
    refuseInProduction('db:seed');

    await seedDatabase();

    console.info('✓ Banco semeado.');
    console.info(SEEDED_ACCOUNTS);
    process.exit(0);
}

// Roda sozinho só quando chamado direto (npm run db:seed). O fresh.ts importa
// `seedDatabase` deste arquivo sem disparar isto.
if (basename(process.argv[1] ?? '').replace(/\.[cm]?[jt]s$/, '') === 'seed') {
    main().catch((error: unknown) => {
        console.error('✗ Falha ao semear:', error instanceof SeedError ? error.message : error);
        process.exit(1);
    });
}
