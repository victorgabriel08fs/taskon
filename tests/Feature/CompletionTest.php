<?php

namespace Tests\Feature;

use App\Models\Board;
use App\Models\BoardList;
use App\Models\Card;
use App\Models\User;
use App\Support\TaskDigest;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * A coluna de conclusão e a fronteira entre "vence hoje" e "vencida".
 *
 * Os dois vieram do mesmo relato: o painel mostrava como vencido um card que
 * estava na coluna "Concluído" e outro que vencia mais tarde no mesmo dia.
 */
class CompletionTest extends TestCase
{
    use RefreshDatabase;

    private Board $board;

    private User $user;

    private BoardList $todo;

    private BoardList $done;

    protected function setUp(): void
    {
        parent::setUp();

        $this->board = Board::factory()->create();
        $this->user = $this->board->owner;
        $this->todo = BoardList::factory()->create(['board_id' => $this->board->id, 'position' => 1]);
        $this->done = BoardList::factory()->create([
            'board_id' => $this->board->id,
            'position' => 2,
            'is_done' => true,
        ]);
    }

    private function move(Card $card, BoardList $to): void
    {
        $this->actingAs($this->user)
            ->patch("/cards/{$card->id}/move", [
                'board_list_id' => $to->id,
                'ordered_ids' => [$card->id],
            ])
            ->assertRedirect();
    }

    public function test_dragging_into_the_done_column_completes_the_card(): void
    {
        $card = Card::factory()->inList($this->todo)->create();

        $this->move($card, $this->done);

        $this->assertNotNull($card->fresh()->completed_at);
    }

    public function test_dragging_out_of_the_done_column_reopens_the_card(): void
    {
        $card = Card::factory()->inList($this->done)->create(['completed_at' => now()->subHour()]);

        $this->move($card, $this->todo);

        $this->assertNull($card->fresh()->completed_at);
    }

    public function test_moving_between_ordinary_columns_does_not_undo_a_manual_completion(): void
    {
        $other = BoardList::factory()->create(['board_id' => $this->board->id, 'position' => 3]);
        $card = Card::factory()->inList($this->todo)->create();

        // Concluída na caixinha do modal, sem sair da coluna.
        $this->actingAs($this->user)->patch("/cards/{$card->id}", ['is_completed' => true]);

        $this->move($card, $other);

        $this->assertNotNull($card->fresh()->completed_at, 'arrastar não pode desfazer a decisão manual');
    }

    public function test_marking_a_column_as_done_completes_who_is_already_inside(): void
    {
        $card = Card::factory()->inList($this->todo)->create(['due_at' => now()->subDays(3)]);

        $this->actingAs($this->user)
            ->patch("/lists/{$this->todo->id}", ['is_done' => true])
            ->assertRedirect();

        $this->assertNotNull($card->fresh()->completed_at);
    }

    public function test_a_new_board_gets_a_done_column(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)->post('/boards', ['title' => 'Novo', 'background' => 'ocean']);

        $lists = Board::firstWhere('title', 'Novo')->lists;

        $this->assertSame(['Concluído'], $lists->where('is_done', true)->pluck('title')->all());
    }

    public function test_a_card_due_later_today_is_not_overdue(): void
    {
        $card = Card::factory()->inList($this->todo)->create(['due_at' => now()->startOfDay()->addHours(1)]);
        $card->members()->attach($this->user->id);

        // Prazo às 01:00, agora é bem mais tarde — mas ainda é hoje.
        $this->travelTo(now()->startOfDay()->addHours(15));

        $digest = TaskDigest::for($this->user->fresh());

        $this->assertCount(0, $digest->overdue);
        $this->assertSame([$card->id], $digest->today->pluck('id')->all());
    }

    public function test_a_card_from_yesterday_is_overdue(): void
    {
        $card = Card::factory()->inList($this->todo)->create(['due_at' => now()->subDay()->endOfDay()]);
        $card->members()->attach($this->user->id);

        $digest = TaskDigest::for($this->user->fresh());

        $this->assertSame([$card->id], $digest->overdue->pluck('id')->all());
    }

    public function test_the_dashboard_agrees_with_the_digest(): void
    {
        $today = Card::factory()->inList($this->todo)->create(['due_at' => now()->startOfDay()->addHour()]);
        $today->members()->attach($this->user->id);

        $late = Card::factory()->inList($this->todo)->create(['due_at' => now()->subDays(2)]);
        $late->members()->attach($this->user->id);

        // Card na coluna de conclusão com prazo velho: concluído, não vencido.
        $finished = Card::factory()->inList($this->done)->create([
            'due_at' => now()->subDays(5),
            'completed_at' => now()->subDay(),
        ]);
        $finished->members()->attach($this->user->id);

        $this->travelTo(now()->startOfDay()->addHours(15));

        $this->actingAs($this->user)
            ->get('/dashboard')
            ->assertInertia(fn ($page) => $page
                ->where('stats.overdue', 1)
                ->where('stats.today', 1)
                ->where('breakdown.overdue', 1)
                ->where('breakdown.today', 1)
                ->where('boards.0.overdue', 1));
    }
}
