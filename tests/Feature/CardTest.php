<?php

namespace Tests\Feature;

use App\Models\Board;
use App\Models\BoardList;
use App\Models\Card;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CardTest extends TestCase
{
    use RefreshDatabase;

    private Board $board;

    private User $user;

    private BoardList $todo;

    private BoardList $doing;

    protected function setUp(): void
    {
        parent::setUp();

        $this->board = Board::factory()->create();
        $this->user = $this->board->owner;
        $this->todo = BoardList::factory()->create(['board_id' => $this->board->id, 'position' => 1]);
        $this->doing = BoardList::factory()->create(['board_id' => $this->board->id, 'position' => 2]);
    }

    public function test_a_card_is_appended_to_the_end_of_the_list(): void
    {
        Card::factory()->inList($this->todo, 1)->create();

        $this->actingAs($this->user)
            ->post("/lists/{$this->todo->id}/cards", ['title' => 'Segundo card'])
            ->assertRedirect();

        $card = Card::firstWhere('title', 'Segundo card');

        $this->assertSame($this->todo->id, $card->board_list_id);
        $this->assertSame($this->board->id, $card->board_id);
        $this->assertEqualsWithDelta(2.0, $card->position, 0.001);
    }

    public function test_whoever_creates_the_card_is_already_a_member_of_it(): void
    {
        // Sem isso o card nasce sem dono e some do "só os meus", do painel e do
        // resumo diário de quem acabou de escrevê-lo.
        $this->actingAs($this->user)
            ->post("/lists/{$this->todo->id}/cards", ['title' => 'Nasce comigo'])
            ->assertRedirect();

        $card = Card::firstWhere('title', 'Nasce comigo');

        $this->assertSame([$this->user->id], $card->members()->pluck('users.id')->all());
    }

    public function test_moving_a_card_to_another_list_rewrites_the_order(): void
    {
        $first = Card::factory()->inList($this->doing, 1)->create();
        $second = Card::factory()->inList($this->doing, 2)->create();
        $moved = Card::factory()->inList($this->todo, 1)->create();

        $this->actingAs($this->user)
            ->patch("/cards/{$moved->id}/move", [
                'board_list_id' => $this->doing->id,
                'ordered_ids' => [$first->id, $moved->id, $second->id],
            ])
            ->assertRedirect();

        $this->assertSame($this->doing->id, $moved->fresh()->board_list_id);
        $this->assertSame(
            [$first->id, $moved->id, $second->id],
            $this->doing->cards()->pluck('id')->all(),
        );
    }

    public function test_a_card_cannot_be_moved_into_a_list_from_another_board(): void
    {
        $foreignList = BoardList::factory()->create();
        $card = Card::factory()->inList($this->todo, 1)->create();

        $this->actingAs($this->user)
            ->patch("/cards/{$card->id}/move", [
                'board_list_id' => $foreignList->id,
                'ordered_ids' => [$card->id],
            ])
            ->assertSessionHasErrors('board_list_id');

        $this->assertSame($this->todo->id, $card->fresh()->board_list_id);
    }

    public function test_completing_a_card_records_activity(): void
    {
        $card = Card::factory()->inList($this->todo, 1)->create();

        $this->actingAs($this->user)
            ->patch("/cards/{$card->id}", ['is_completed' => true])
            ->assertRedirect();

        $this->assertNotNull($card->fresh()->completed_at);
        $this->assertDatabaseHas('activities', [
            'card_id' => $card->id,
            'type' => 'card.completed',
        ]);
    }

    public function test_labels_are_toggled_and_scoped_to_the_board(): void
    {
        $card = Card::factory()->inList($this->todo, 1)->create();
        $label = $this->board->labels()->create(['name' => 'Urgente', 'color' => 'rose']);
        $foreignLabel = Board::factory()->create()->labels()->create(['name' => 'X', 'color' => 'blue']);

        $this->actingAs($this->user)->post("/cards/{$card->id}/labels/{$label->id}");
        $this->assertTrue($card->labels()->whereKey($label->id)->exists());

        $this->actingAs($this->user)->post("/cards/{$card->id}/labels/{$label->id}");
        $this->assertFalse($card->labels()->whereKey($label->id)->exists());

        $this->actingAs($this->user)
            ->post("/cards/{$card->id}/labels/{$foreignLabel->id}")
            ->assertNotFound();
    }

    public function test_deleting_a_card_redirects_to_the_board_not_back_to_the_card_url(): void
    {
        $card = Card::factory()->inList($this->todo, 1)->create();

        $this->actingAs($this->user)
            ->from("/boards/{$this->board->id}/cards/{$card->id}")
            ->delete("/cards/{$card->id}")
            ->assertRedirect("/boards/{$this->board->id}");

        $this->assertDatabaseMissing('cards', ['id' => $card->id]);
    }

    public function test_outsiders_cannot_touch_cards(): void
    {
        $card = Card::factory()->inList($this->todo, 1)->create();
        $stranger = User::factory()->create();

        $this->actingAs($stranger)->patch("/cards/{$card->id}", ['title' => 'Hackeado'])->assertForbidden();
        $this->assertNotSame('Hackeado', $card->fresh()->title);
    }

    public function test_the_board_payload_carries_checklist_and_comment_counters(): void
    {
        $card = Card::factory()->inList($this->todo, 1)->create();
        $checklist = $card->checklists()->create(['title' => 'Passos', 'position' => 1]);
        $checklist->items()->create(['content' => 'a', 'is_done' => true, 'position' => 1]);
        $checklist->items()->create(['content' => 'b', 'is_done' => false, 'position' => 2]);
        $card->comments()->forceCreate(['user_id' => $this->user->id, 'body' => 'oi']);

        $this->actingAs($this->user)
            ->get("/boards/{$this->board->id}")
            ->assertInertia(fn ($page) => $page
                ->where('board.lists.0.cards.0.checklist_total', 2)
                ->where('board.lists.0.cards.0.checklist_done', 1)
                ->where('board.lists.0.cards.0.comments_count', 1)
                ->etc());
    }
}
