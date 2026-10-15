/**
 * A varredura dos concluídos na linha de comando — o antigo
 * `php artisan taskon:archive-done-cards`:
 *
 *   npm run archive-done                     # varre todos os quadros com prazo
 *   npm run archive-done -- --dry-run        # mostra o que sairia, sem arquivar nada
 *   npm run archive-done -- --board=12       # varre só este quadro
 *
 * Em produção quem a dispara toda madrugada é o Cron da Vercel
 * (/api/cron/archive-done-cards); as duas portas usam o mesmo serviço.
 */
import './_bootstrap';
import { MAX_ID } from '@/server/validation';

function option(args: string[], name: string): string | null {
    const inline = args.find((arg) => arg.startsWith(`--${name}=`));

    if (inline) return inline.slice(name.length + 3);

    const index = args.indexOf(`--${name}`);

    return index >= 0 ? (args[index + 1] ?? null) : null;
}

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const board = option(args, 'board');
    const boardId = board === null ? null : Number(board);

    if (boardId !== null && (!Number.isInteger(boardId) || boardId <= 0 || boardId > MAX_ID)) {
        console.error('✗ --board precisa ser o id numérico de um quadro.');
        process.exit(1);
    }

    // Import tardio: o banco só é aberto depois de o .env ser carregado.
    const { describeSweep, sweepBoards } = await import('@/server/services/done-card-archiver');
    const report = await sweepBoards({ dryRun, boardId });
    const lines = describeSweep(report);

    // O total vem destacado numa linha própria, como no comando artisan.
    lines.forEach((line, index) => {
        if (index === lines.length - 1 && report.boards.length > 0) console.log('');
        console.log(line);
    });

    if (!dryRun) {
        // A faxina do cron, sem passar por src/server/auth/session.ts (que lê
        // cookies do Next e não roda fora dele): sessões vencidas, janelas de
        // rate limit que já fecharam, convites vencidos e pedidos de
        // confirmação de e-mail vencidos — a mesma lista da rota do cron.
        const { lte } = await import('drizzle-orm');
        const { db } = await import('@/server/db');
        const { sessions } = await import('@/server/db/schema');
        const { pruneRateLimits } = await import('@/server/auth/rate-limit');
        const { pruneExpiredEmailVerifications } = await import('@/server/services/email-verification');
        const { pruneExpiredInvitations } = await import('@/server/services/invitations');
        const now = new Date();

        await db.delete(sessions).where(lte(sessions.expiresAt, now));
        await pruneRateLimits(now);
        await pruneExpiredInvitations(now);
        await pruneExpiredEmailVerifications(now);
    }

    process.exit(0);
}

main().catch((error) => {
    console.error('✗ Falha na varredura:', error);
    process.exit(1);
});
