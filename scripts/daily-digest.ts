/**
 * O resumo diário na linha de comando — o antigo
 * `php artisan taskon:daily-digest`:
 *
 *   npm run digest                              # envia para quem tem algo a relatar
 *   npm run digest -- --dry-run                 # mostra quem receberia, sem enviar nada
 *   npm run digest -- --user=12                 # só esta pessoa (id ou e-mail)
 *   npm run digest -- --user=ana@exemplo.com --force
 *                                               # ignora o opt-out e o "já recebeu hoje"
 *
 * Em produção quem o dispara toda manhã é o Cron da Vercel
 * (/api/cron/daily-digest); as duas portas usam o mesmo serviço. Sai com
 * código 1 se algum envio falhou.
 */
import './_bootstrap';

function option(args: string[], name: string): string | null {
    const inline = args.find((arg) => arg.startsWith(`--${name}=`));

    if (inline) return inline.slice(name.length + 3);

    const index = args.indexOf(`--${name}`);
    const next = index >= 0 ? args[index + 1] : undefined;

    return next !== undefined && !next.startsWith('--') ? next : null;
}

async function main() {
    const args = process.argv.slice(2);

    // Import tardio: o banco e a configuração só são lidos depois de o .env
    // ser carregado.
    const { runDailyDigest } = await import('@/server/services/daily-digest');

    const result = await runDailyDigest({
        now: new Date(),
        user: option(args, 'user'),
        force: args.includes('--force'),
        dryRun: args.includes('--dry-run'),
    });

    for (const line of result.lines) console.log(line);

    process.exit(result.failed > 0 ? 1 : 0);
}

main().catch((error) => {
    console.error('✗ Falha no resumo diário:', error);
    process.exit(1);
});
