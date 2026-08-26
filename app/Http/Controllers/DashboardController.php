<?php

namespace App\Http\Controllers;

use App\Http\Resources\ActivityResource;
use App\Http\Resources\BoardProgressResource;
use App\Http\Resources\DeadlineResource;
use App\Models\Activity;
use App\Models\Board;
use App\Models\Card;
use App\Models\User;
use App\Support\TaskDigest;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Inertia\Inertia;
use Inertia\Response;

/**
 * O painel.
 *
 * Duas escalas convivem aqui, e a tela deixa isso explícito nos títulos:
 *
 *   - "Suas tarefas" — só os cards ATRIBUÍDOS à pessoa (Card::assignedTo), o
 *     mesmo recorte do resumo diário por e-mail. Se divergirem, o e-mail passa
 *     a mentir sobre a tela.
 *   - "Seus quadros" — tudo que existe nos quadros de que ela participa,
 *     incluindo o trabalho dos colegas.
 *
 * São ~8 consultas, todas agregadas: nenhuma traz linha que a tela não use.
 */
class DashboardController extends Controller
{
    /** Dias do gráfico de ritmo. 14 cabe em duas semanas cheias sem virar borrão. */
    private const TREND_DAYS = 14;

    /** Quantos quadros e prazos a tela mostra antes de mandar para a lista completa. */
    private const TOP_BOARDS = 6;

    private const TOP_DEADLINES = 6;

    public function index(Request $request): Response
    {
        $user = $request->user();
        $now = CarbonImmutable::now();

        $digest = TaskDigest::for($user, $now);
        $boardIds = $user->boards()->whereNull('boards.archived_at')->pluck('boards.id');

        // Vencidas primeiro: quem abre o painel precisa ver o incêndio antes
        // da agenda.
        $deadlines = $digest->overdue
            ->concat($digest->today)
            ->concat($digest->upcoming)
            ->take(self::TOP_DEADLINES);

        return Inertia::render('dashboard', [
            'stats' => [
                'open' => $digest->openCount,
                'overdue' => $digest->overdue->count(),
                'today' => $digest->today->count(),
                'upcoming' => $digest->upcoming->count(),
                'completed_week' => $this->completedBetween($user, $now->subDays(7), $now),
                'completed_previous_week' => $this->completedBetween($user, $now->subDays(14), $now->subDays(7)),
                'boards' => $boardIds->count(),
            ],
            'breakdown' => $this->breakdown($user, $now),
            'deadlines' => DeadlineResource::collection($deadlines),
            'trend' => $this->trend($boardIds, $now),
            'boards' => BoardProgressResource::collection($this->boards($user, $now)),
            'horizonDays' => (int) config('taskon.digest.horizon_days'),

            // O feed é o pedaço mais caro e o menos urgente: sai depois da
            // primeira pintura, como no quadro.
            'activity' => Inertia::defer(fn () => ActivityResource::collection(
                Activity::query()
                    ->whereIn('board_id', $boardIds)
                    ->with(['user', 'board:id,title,background'])
                    ->latest()
                    ->limit(12)
                    ->get()
            )),
        ]);
    }

    /**
     * Distribuição das tarefas abertas por prazo — o anel da tela.
     *
     * Traz só a coluna due_at e separa em PHP: uma consulta em vez de cinco
     * COUNTs, e as fronteiras ficam idênticas às do TaskDigest porque são o
     * mesmo código de comparação.
     *
     * @return array<string, int>
     */
    private function breakdown(User $user, CarbonImmutable $now): array
    {
        // Mesmas fronteiras do TaskDigest: o dia, não a hora. Ver o comentário lá.
        $startOfToday = $now->startOfDay();
        $endOfToday = $now->endOfDay();
        $horizon = $now->addDays((int) config('taskon.digest.horizon_days'))->endOfDay();

        $dues = Card::query()
            ->assignedTo($user)
            ->whereNull('cards.completed_at')
            ->pluck('due_at');

        return [
            'overdue' => $dues->filter(fn ($due) => $due !== null && $due->lt($startOfToday))->count(),
            'today' => $dues->filter(fn ($due) => $due !== null && $due->gte($startOfToday) && $due->lte($endOfToday))->count(),
            'upcoming' => $dues->filter(fn ($due) => $due !== null && $due->gt($endOfToday) && $due->lte($horizon))->count(),
            'later' => $dues->filter(fn ($due) => $due !== null && $due->gt($horizon))->count(),
            'none' => $dues->filter(fn ($due) => $due === null)->count(),
        ];
    }

    /**
     * `history: true` — o card concluído na segunda e arquivado na quarta não
     * pode desaparecer do "concluídas na semana" na quinta. Aqui se conta o que
     * foi feito, e o que foi feito não se desfaz por ter saído da tela.
     */
    private function completedBetween(User $user, CarbonImmutable $from, CarbonImmutable $to): int
    {
        return Card::query()
            ->assignedTo($user, history: true)
            ->whereBetween('cards.completed_at', [$from, $to])
            ->count();
    }

    /**
     * Criados x concluídos por dia, em todos os quadros do usuário.
     *
     * DATE() agrupa no fuso do app (o mesmo em que os prazos são gravados), e o
     * laço preenche os dias sem movimento — sem isso o gráfico pularia o
     * domingo e mentiria sobre o ritmo.
     *
     * @param  Collection<int, int>  $boardIds
     * @return array<int, array{date: string, created: int, completed: int}>
     */
    private function trend(Collection $boardIds, CarbonImmutable $now): array
    {
        $since = $now->subDays(self::TREND_DAYS - 1)->startOfDay();

        // `counted()` e não `whereNull(archived_at)`: o gráfico de ritmo é
        // memória. Se arquivar apagasse os dias passados, ligar o arquivamento
        // automático de 3 dias achataria a linha de "concluídos" para zero em
        // quase todo o período — exatamente o oposto do que aconteceu.
        $count = fn (string $column) => Card::query()
            ->whereIn('board_id', $boardIds)
            ->counted()
            ->where($column, '>=', $since)
            ->selectRaw("DATE({$column}) as day, COUNT(*) as total")
            ->groupBy('day')
            ->pluck('total', 'day');

        $created = $count('created_at');
        $completed = $count('completed_at');

        return collect(range(0, self::TREND_DAYS - 1))
            ->map(function (int $offset) use ($since, $created, $completed) {
                $day = $since->addDays($offset)->format('Y-m-d');

                return [
                    'date' => $day,
                    'created' => (int) ($created[$day] ?? 0),
                    'completed' => (int) ($completed[$day] ?? 0),
                ];
            })
            ->all();
    }

    /** @return Collection<int, Board> */
    private function boards(User $user, CarbonImmutable $now): Collection
    {
        return $user->boards()
            ->whereNull('boards.archived_at')
            ->withCount([
                // Total e concluídos seguem o recorte de progresso (o arquivado
                // que já estava pronto continua contando dos dois lados);
                // vencidos, não — arquivado não é mais problema de ninguém.
                'cards as total_count' => fn (Builder $q) => $q->counted(),
                'cards as done_count' => fn (Builder $q) => $q->whereNotNull('cards.completed_at'),
                'cards as overdue_count' => fn (Builder $q) => $q
                    ->whereNull('cards.archived_at')
                    ->whereNull('cards.completed_at')
                    // startOfDay, não $now: o mesmo corte do resto do painel.
                    ->where('cards.due_at', '<', $now->startOfDay()),
            ])
            ->orderByDesc('total_count')
            ->orderBy('boards.title')
            ->limit(self::TOP_BOARDS)
            ->get();
    }
}
