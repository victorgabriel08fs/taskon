import { authorizedCron, queryFlag } from '@/server/cron';
import { runDailyDigest } from '@/server/services/daily-digest';

/**
 * O resumo diário — o antigo `php artisan taskon:daily-digest` agendado em
 * routes/console.php.
 *
 * Quem chama é o Cron da Vercel (vercel.json, 10:00 UTC = 07:00 em São Paulo,
 * o `config.digest.at` que a tela de notificações promete). Mudou um, mude o
 * outro.
 *
 * Para testar na mão (com o mesmo `Authorization` do cron):
 *
 *   ?dry-run=1          mostra quem receberia, sem enviar nada
 *   ?user=12            só esta pessoa (id ou e-mail)
 *   ?force=1            ignora o opt-out, o "já recebeu hoje" e o resumo vazio
 *
 * Responde 500 quando algum envio falhou — o mesmo "exit code 1" do comando —,
 * para a falha aparecer no painel de crons da Vercel.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
    if (!authorizedCron(request)) {
        return Response.json({ error: 'Não autorizado.' }, { status: 401 });
    }

    const params = new URL(request.url).searchParams;
    const dryRun = queryFlag(params.get('dry-run'));

    try {
        const result = await runDailyDigest({
            now: new Date(),
            user: params.get('user'),
            force: queryFlag(params.get('force')),
            dryRun,
        });

        console.info(`[cron:daily-digest]${dryRun ? ' (dry-run)' : ''}\n${result.lines.join('\n')}`);

        return Response.json({ ok: result.failed === 0, ...result }, { status: result.failed > 0 ? 500 : 200 });
    } catch (error) {
        console.error('[cron:daily-digest] falhou', error);

        return Response.json({ ok: false, error: 'O disparo falhou; veja o log da função.' }, { status: 500 });
    }
}
