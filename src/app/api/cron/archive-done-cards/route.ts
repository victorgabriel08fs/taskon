import { pruneRateLimits } from '@/server/auth/rate-limit';
import { pruneExpiredSessions } from '@/server/auth/session';
import { authorizedCron, queryFlag } from '@/server/cron';
import { MAX_ID } from '@/server/validation';
import { describeSweep, sweepBoards } from '@/server/services/done-card-archiver';
import { pruneExpiredEmailVerifications } from '@/server/services/email-verification';
import { pruneExpiredInvitations } from '@/server/services/invitations';

/**
 * A varredura noturna dos concluídos — o antigo `php artisan
 * taskon:archive-done-cards` agendado em routes/console.php.
 *
 * Quem chama é o Cron da Vercel (vercel.json, 06:00 UTC = 03:00 em São
 * Paulo). De madrugada de propósito (config.autoArchive.at): o card sai do
 * quadro entre um expediente e outro, não debaixo do cursor de quem está
 * olhando para ele.
 *
 * Para testar na mão: `?dry-run=1` mostra o que sairia sem arquivar nada, e
 * `?board=ID` varre só um quadro (com o mesmo `Authorization` do cron).
 *
 * Aproveita a viagem para a faxina noturna: sessões vencidas, convites
 * vencidos, pedidos de confirmação de e-mail vencidos e janelas de rate limit
 * que já fecharam (o que o Laravel fazia por loteria a cada requisição). O
 * dry-run não apaga nada, nem isso.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
    if (!authorizedCron(request)) {
        return Response.json({ error: 'Não autorizado.' }, { status: 401 });
    }

    const params = new URL(request.url).searchParams;
    const dryRun = queryFlag(params.get('dry-run'));
    const board = params.get('board');
    const boardId = board === null ? null : Number(board);

    if (boardId !== null && (!Number.isInteger(boardId) || boardId <= 0 || boardId > MAX_ID)) {
        return Response.json({ error: '`board` precisa ser o id numérico de um quadro.' }, { status: 422 });
    }

    try {
        const report = await sweepBoards({ dryRun, boardId });
        const summary = describeSweep(report);

        if (!dryRun) {
            const now = new Date();

            await pruneExpiredSessions(now);
            await pruneRateLimits(now);
            await pruneExpiredInvitations(now);
            await pruneExpiredEmailVerifications(now);
        }

        console.info(`[cron:archive-done-cards]${dryRun ? ' (dry-run)' : ''}\n${summary.join('\n')}`);

        return Response.json({ ok: true, ...report, summary, housekeeping: !dryRun });
    } catch (error) {
        console.error('[cron:archive-done-cards] falhou', error);

        return Response.json({ ok: false, error: 'A varredura falhou; veja o log da função.' }, { status: 500 });
    }
}
