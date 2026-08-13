<?php

namespace App\Console\Commands;

use App\Mail\DailyDigest;
use App\Models\User;
use App\Support\TaskDigest;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Throwable;

class SendDailyDigest extends Command
{
    protected $signature = 'taskon:daily-digest
                            {--user= : Manda só para esta pessoa (id ou e-mail)}
                            {--force : Ignora o opt-out e o carimbo de "já enviado hoje"}
                            {--dry-run : Mostra quem receberia, sem enviar nada}';

    protected $description = 'Envia o resumo diário de tarefas (vencidas, de hoje e próximas)';

    public function handle(): int
    {
        $now = CarbonImmutable::now();
        $force = (bool) $this->option('force');
        $dryRun = (bool) $this->option('dry-run');

        $this->components->info(
            ($dryRun ? 'Simulando o resumo de ' : 'Enviando o resumo de ')
            .$now->locale('pt_BR')->translatedFormat('d \d\e F \à\s H:i')
        );

        $sent = $skipped = $failed = 0;

        $this->recipients()->chunkById(100, function ($users) use ($now, $force, $dryRun, &$sent, &$skipped, &$failed) {
            foreach ($users as $user) {
                // Reenviar o mesmo resumo é pior que não enviar: quem já leu
                // ignora, quem não leu passa a ignorar. O carimbo é a trava.
                if (! $force && $user->digest_last_sent_at?->isSameDay($now)) {
                    $skipped++;
                    $this->line("  <fg=gray>–</> {$user->email} <fg=gray>já recebeu hoje</>");

                    continue;
                }

                $digest = TaskDigest::for($user, $now);

                if ($digest->isEmpty() && config('taskon.digest.skip_when_empty') && ! $force) {
                    $skipped++;
                    $this->line("  <fg=gray>–</> {$user->email} <fg=gray>nada a relatar</>");

                    continue;
                }

                $resumo = "{$digest->overdue->count()} vencida(s), {$digest->today->count()} hoje, {$digest->upcoming->count()} à frente";

                if ($dryRun) {
                    $sent++;
                    $this->line("  <fg=cyan>?</> {$user->email} <fg=gray>{$resumo}</>");

                    continue;
                }

                try {
                    Mail::to($user)->send(new DailyDigest($digest));

                    // forceFill: as colunas do resumo não são fillable por
                    // atribuição em massa, e nem deveriam ser.
                    $user->forceFill(['digest_last_sent_at' => $now])->save();

                    $sent++;
                    $this->line("  <fg=green>✓</> {$user->email} <fg=gray>{$resumo}</>");
                } catch (Throwable $e) {
                    // Um endereço recusado pelo Resend não pode derrubar a fila
                    // inteira — o carimbo fica intacto e a próxima rodada tenta
                    // de novo.
                    $failed++;
                    $this->line("  <fg=red>✗</> {$user->email} <fg=gray>{$e->getMessage()}</>");
                    Log::error('Falha ao enviar o resumo diário', [
                        'user_id' => $user->id,
                        'exception' => $e,
                    ]);
                }
            }
        });

        $this->newLine();
        $this->components->twoColumnDetail('<fg=green>Enviados</>', (string) $sent);
        $this->components->twoColumnDetail('<fg=gray>Ignorados</>', (string) $skipped);

        if ($failed > 0) {
            $this->components->twoColumnDetail('<fg=red>Falhas</>', (string) $failed);

            return self::FAILURE;
        }

        return self::SUCCESS;
    }

    /** @return Builder<User> */
    private function recipients(): Builder
    {
        $only = $this->option('user');

        return User::query()
            ->when(! $this->option('force'), fn (Builder $q) => $q->where('daily_digest', true))
            ->when($only !== null, fn (Builder $q) => is_numeric($only)
                ? $q->whereKey($only)
                : $q->where('email', $only))
            ->orderBy('id');
    }
}
