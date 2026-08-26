<?php

namespace App\Console\Commands;

use App\Models\Board;
use App\Support\DoneCardArchiver;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Illuminate\Database\Eloquent\Builder;

/**
 * A varredura noturna dos concluídos. Quem a dispara sozinha é o serviço
 * 'taskon-scheduler' do docker-compose (php artisan schedule:work); o
 * agendamento em si está em routes/console.php.
 */
class ArchiveDoneCards extends Command
{
    protected $signature = 'taskon:archive-done-cards
                            {--board= : Varre só este quadro (id)}
                            {--dry-run : Mostra o que sairia do quadro, sem arquivar nada}';

    protected $description = 'Arquiva os cards concluídos há mais tempo que o prazo de cada quadro';

    public function handle(): int
    {
        $now = CarbonImmutable::now();
        $dryRun = (bool) $this->option('dry-run');

        $boards = $this->boards()->get();

        if ($boards->isEmpty()) {
            $this->components->info('Nenhum quadro com arquivamento automático ligado.');

            return self::SUCCESS;
        }

        $this->components->info(
            ($dryRun ? 'Simulando a varredura de ' : 'Varrendo ')
            .DoneCardArchiver::plural($boards->count(), 'quadro', 'quadros')
        );

        $total = 0;

        foreach ($boards as $board) {
            $days = (int) $board->auto_archive_done_after_days;

            // No dry-run a contagem usa exatamente o mesmo filtro do sweep —
            // é a única forma de a simulação valer alguma coisa.
            $count = $dryRun
                ? DoneCardArchiver::pending($board, $now)
                : DoneCardArchiver::sweep($board, $now);

            $total += $count;

            $prazo = DoneCardArchiver::plural($days, 'dia', 'dias');

            if ($count === 0) {
                $this->line("  <fg=gray>–</> {$board->title} <fg=gray>nada além de {$prazo}</>");

                continue;
            }

            $marca = $dryRun ? '<fg=cyan>?</>' : '<fg=green>✓</>';
            $saida = DoneCardArchiver::plural($count, 'card', 'cards');

            $this->line("  {$marca} {$board->title} <fg=gray>{$saida} · prazo de {$prazo}</>");
        }

        $this->newLine();
        $this->components->twoColumnDetail(
            $dryRun ? '<fg=cyan>Sairiam</>' : '<fg=green>Arquivados</>',
            (string) $total,
        );

        return self::SUCCESS;
    }

    /** @return Builder<Board> */
    private function boards(): Builder
    {
        $only = $this->option('board');

        return Board::query()
            ->whereNull('archived_at')
            ->whereNotNull('auto_archive_done_after_days')
            ->when($only !== null, fn (Builder $q) => $q->whereKey($only))
            ->orderBy('id');
    }
}
