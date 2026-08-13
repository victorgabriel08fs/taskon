<?php

namespace App\Support;

use App\Models\Card;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;

/**
 * O retrato das tarefas de uma pessoa num instante — a matéria-prima do resumo
 * diário e da tela de painel.
 *
 * Só entram cards ATRIBUÍDOS ao usuário. Um quadro compartilhado pode ter
 * centenas de cards que não são problema dele; o resumo perde a serventia se
 * virar despejo do quadro inteiro.
 *
 * Três consultas por pessoa: os cards com prazo no horizonte, os concluídos nas
 * últimas 24 h e a contagem de abertos. É pouco o bastante para o comando rodar
 * em lote sem paginar nada.
 */
final class TaskDigest
{
    /**
     * @param  Collection<int, Card>  $overdue  Prazo já passou.
     * @param  Collection<int, Card>  $today  Vence hoje, ainda dá tempo.
     * @param  Collection<int, Card>  $upcoming  Vence dentro do horizonte.
     * @param  Collection<int, Card>  $completed  Concluídos nas últimas 24 h.
     */
    private function __construct(
        public readonly User $user,
        public readonly CarbonImmutable $now,
        public readonly Collection $overdue,
        public readonly Collection $today,
        public readonly Collection $upcoming,
        public readonly Collection $completed,
        public readonly int $openCount,
    ) {}

    public static function for(User $user, ?CarbonImmutable $now = null): self
    {
        $now ??= CarbonImmutable::now();

        $endOfToday = $now->endOfDay();
        $horizon = $now->addDays((int) config('taskon.digest.horizon_days'))->endOfDay();

        $due = self::assignedTo($user)
            ->whereNull('cards.completed_at')
            ->whereNotNull('cards.due_at')
            ->where('cards.due_at', '<=', $horizon)
            ->orderBy('cards.due_at')
            ->get();

        $completed = self::assignedTo($user)
            ->whereNotNull('cards.completed_at')
            ->where('cards.completed_at', '>=', $now->subDay())
            ->orderByDesc('cards.completed_at')
            ->get();

        return new self(
            user: $user,
            now: $now,
            overdue: $due->filter(fn (Card $card) => $card->due_at->lt($now))->values(),
            today: $due->filter(fn (Card $card) => $card->due_at->gte($now) && $card->due_at->lte($endOfToday))->values(),
            upcoming: $due->filter(fn (Card $card) => $card->due_at->gt($endOfToday))->values(),
            completed: $completed,
            openCount: self::assignedTo($user)->whereNull('cards.completed_at')->count(),
        );
    }

    /**
     * O mesmo recorte de "minhas tarefas" que o painel usa — o scope mora no
     * model justamente para as duas telas não divergirem.
     *
     * @return Builder<Card>
     */
    private static function assignedTo(User $user): Builder
    {
        return Card::query()
            ->assignedTo($user)
            ->with(['board:id,title,background', 'list:id,title']);
    }

    /** Nada vencido, nada no horizonte, nada concluído: não há resumo a mandar. */
    public function isEmpty(): bool
    {
        return $this->overdue->isEmpty()
            && $this->today->isEmpty()
            && $this->upcoming->isEmpty()
            && $this->completed->isEmpty();
    }

    /**
     * As seções na ordem em que aparecem no e-mail, já cortadas no teto.
     *
     * O corte é só de exibição: o contador de cada seção continua mostrando o
     * total, então "3 de 12" fica honesto.
     *
     * @return array<int, array{key: string, title: string, tone: string, total: int, cards: Collection<int, Card>}>
     */
    public function sections(): array
    {
        $max = (int) config('taskon.digest.max_per_section');

        $sections = [
            ['key' => 'overdue', 'title' => 'Vencidas', 'tone' => 'danger', 'cards' => $this->overdue],
            ['key' => 'today', 'title' => 'Vencem hoje', 'tone' => 'warning', 'cards' => $this->today],
            ['key' => 'upcoming', 'title' => 'Próximos dias', 'tone' => 'neutral', 'cards' => $this->upcoming],
        ];

        return collect($sections)
            ->reject(fn (array $section) => $section['cards']->isEmpty())
            ->map(fn (array $section) => [
                ...$section,
                'total' => $section['cards']->count(),
                'cards' => $section['cards']->take($max),
            ])
            ->values()
            ->all();
    }
}
