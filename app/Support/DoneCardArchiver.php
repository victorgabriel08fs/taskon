<?php

namespace App\Support;

use App\Models\Board;
use App\Models\Card;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;

/**
 * A varredura que tira do quadro o que já foi concluído há tempo demais.
 *
 * A coluna "Concluído" é um cemitério que cresce: em algumas semanas ela tem
 * mais cards que todas as outras somadas, e o que interessa — o que falta —
 * fica espremido. Este é o serviço que a esvazia sozinha.
 *
 * Arquivar NÃO apaga. O card continua no banco com `archived_at` preenchido:
 * some das colunas, continua contando no progresso do quadro (ver
 * `Card::scopeCounted`) e volta pela tela de arquivados.
 *
 * Duas portas chamam daqui — o comando agendado e o botão "Arquivar agora" —
 * justamente para as duas não divergirem sobre o que "passou do prazo" quer
 * dizer.
 */
final class DoneCardArchiver
{
    /**
     * Cards do quadro que já passaram do prazo.
     *
     * `completed_at` e não `updated_at`: o relógio começa a correr quando a
     * tarefa terminou, não na última vez que alguém encostou no card. Reordenar
     * uma coluna toca o `updated_at` de todo mundo que está nela, e o prazo
     * nunca venceria num quadro em uso.
     *
     * @return Builder<Card>
     */
    private static function overdue(Board $board, int $days, CarbonImmutable $now): Builder
    {
        return Card::query()
            ->where('board_id', $board->getKey())
            ->whereNull('archived_at')
            ->whereNotNull('completed_at')
            ->where('completed_at', '<=', $now->subDays($days));
    }

    /** Quantos cards a próxima varredura levaria — sem levar nenhum. */
    public static function pending(Board $board, ?CarbonImmutable $now = null): int
    {
        $days = $board->auto_archive_done_after_days;

        return $days === null
            ? 0
            : self::overdue($board, $days, $now ?? CarbonImmutable::now())->count();
    }

    /**
     * Arquiva e devolve quantos saíram.
     *
     * O histórico ganha UMA linha por varredura, não uma por card: vinte
     * "arquivou tal card" seguidos afogariam o feed do quadro no dia em que a
     * pessoa ligar o recurso pela primeira vez.
     */
    public static function sweep(Board $board, ?CarbonImmutable $now = null): int
    {
        $days = $board->auto_archive_done_after_days;

        if ($days === null) {
            return 0;
        }

        $now ??= CarbonImmutable::now();
        $archived = self::overdue($board, $days, $now)->update(['archived_at' => $now]);

        if ($archived > 0) {
            ActivityLogger::log(
                $board,
                'cards.auto_archived',
                'arquivou '.self::plural($archived, 'card concluído', 'cards concluídos')
                    .' há mais de '.self::plural($days, 'dia', 'dias'),
                properties: ['count' => $archived, 'after_days' => $days],
            );
        }

        return $archived;
    }

    /** "1 dia" / "7 dias" — o mesmo pluralize() da interface, do lado do PHP. */
    public static function plural(int $count, string $singular, string $plural): string
    {
        return $count.' '.($count === 1 ? $singular : $plural);
    }
}
