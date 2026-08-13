<?php

namespace Tests\Feature;

use App\Http\Middleware\HandleInertiaRequests;
use App\Models\Board;
use App\Models\BoardList;
use App\Models\Card;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DashboardTest extends TestCase
{
    use RefreshDatabase;

    private function cardIn(Board $board, array $attributes = [], ?User $assignee = null): Card
    {
        $list = BoardList::factory()->create(['board_id' => $board->id]);
        $card = Card::factory()->inList($list)->create($attributes);

        $assignee && $card->members()->attach($assignee->id);

        return $card;
    }

    public function test_it_counts_only_cards_assigned_to_the_user(): void
    {
        $user = User::factory()->create();
        $colleague = User::factory()->create();
        $board = Board::factory()->create(['owner_id' => $user->id]);
        $board->members()->attach($colleague->id, ['role' => 'member']);

        $this->cardIn($board, ['due_at' => now()->subDay()], $user);
        $this->cardIn($board, ['due_at' => now()->addHours(2)], $user);
        // Mesmo quadro, mas é problema do colega: não entra nos números da pessoa.
        $this->cardIn($board, ['due_at' => now()->subDays(3)], $colleague);

        $this->actingAs($user)
            ->get('/dashboard')
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('dashboard')
                ->where('stats.overdue', 1)
                ->where('stats.today', 1)
                ->where('breakdown.overdue', 1)
                ->has('deadlines', 2)
                // Vencidas primeiro, para o incêndio aparecer antes da agenda.
                ->where('deadlines.0.due_at', fn ($due) => $due < now()->toIso8601String()));
    }

    public function test_the_board_progress_counts_every_card_not_only_the_users(): void
    {
        $user = User::factory()->create();
        $board = Board::factory()->create(['owner_id' => $user->id, 'title' => 'Compartilhado']);

        $this->cardIn($board, ['completed_at' => now()]);
        $this->cardIn($board);
        $this->cardIn($board, ['due_at' => now()->subDay()]);

        $this->actingAs($user)
            ->get('/dashboard')
            ->assertInertia(fn ($page) => $page
                ->where('boards.0.title', 'Compartilhado')
                ->where('boards.0.total', 3)
                ->where('boards.0.done', 1)
                ->where('boards.0.overdue', 1));
    }

    public function test_the_trend_fills_days_without_movement(): void
    {
        $user = User::factory()->create();
        $board = Board::factory()->create(['owner_id' => $user->id]);
        $this->cardIn($board);

        $this->actingAs($user)
            ->get('/dashboard')
            ->assertInertia(fn ($page) => $page
                ->has('trend', 14)
                ->where('trend.13.created', 1)
                ->where('trend.0.created', 0));
    }

    public function test_boards_of_other_people_never_appear(): void
    {
        $user = User::factory()->create();
        $stranger = Board::factory()->create();
        $this->cardIn($stranger, ['due_at' => now()->subDay()]);

        $this->actingAs($user)
            ->get('/dashboard')
            ->assertInertia(fn ($page) => $page
                ->where('stats.boards', 0)
                ->has('boards', 0)
                ->has('deadlines', 0));
    }

    public function test_the_activity_feed_is_deferred(): void
    {
        $user = User::factory()->create();
        Board::factory()->create(['owner_id' => $user->id]);

        // Na primeira pintura a prop nem existe: o Inertia a busca depois.
        $this->actingAs($user)
            ->get('/dashboard')
            ->assertInertia(fn ($page) => $page->missing('activity'));

        // O X-Inertia-Version não é enfeite: sem ele o Laravel devolve 409
        // (conflito de versão de asset) e a requisição parcial nem chega.
        // A versão vem do middleware — o facade só a conhece durante o request.
        $this->actingAs($user)
            ->withHeaders([
                'X-Inertia' => 'true',
                'X-Inertia-Version' => (new HandleInertiaRequests)->version(request()),
                'X-Inertia-Partial-Data' => 'activity',
                'X-Inertia-Partial-Component' => 'dashboard',
            ])
            ->get('/dashboard')
            // assertInertia não serve aqui: ele espera a view HTML com a prop
            // `page`, e a requisição parcial devolve JSON puro.
            ->assertOk()
            ->assertJsonPath('component', 'dashboard')
            ->assertJsonStructure(['props' => ['activity']]);
    }

    public function test_guests_are_sent_to_the_login(): void
    {
        $this->get('/dashboard')->assertRedirect('/login');
    }
}
