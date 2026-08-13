<?php

namespace Tests\Feature;

use App\Models\Board;
use App\Models\BoardList;
use App\Models\Card;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class BoardListTest extends TestCase
{
    use RefreshDatabase;

    public function test_reordering_lists_uses_the_order_sent_by_the_client(): void
    {
        $board = Board::factory()->create();
        $a = BoardList::factory()->create(['board_id' => $board->id, 'position' => 1]);
        $b = BoardList::factory()->create(['board_id' => $board->id, 'position' => 2]);
        $c = BoardList::factory()->create(['board_id' => $board->id, 'position' => 3]);

        $this->actingAs($board->owner)
            ->patch("/boards/{$board->id}/lists/reorder", ['ordered_ids' => [$c->id, $a->id, $b->id]])
            ->assertRedirect();

        $this->assertSame([$c->id, $a->id, $b->id], $board->lists()->pluck('id')->all());
    }

    public function test_reorder_ignores_lists_from_other_boards(): void
    {
        $board = Board::factory()->create();
        $mine = BoardList::factory()->create(['board_id' => $board->id, 'position' => 1]);
        $foreign = BoardList::factory()->create(['position' => 9]);

        $this->actingAs($board->owner)
            ->patch("/boards/{$board->id}/lists/reorder", ['ordered_ids' => [$foreign->id, $mine->id]]);

        $this->assertEqualsWithDelta(9.0, $foreign->fresh()->position, 0.001);
        $this->assertEqualsWithDelta(2.0, $mine->fresh()->position, 0.001);
    }

    public function test_deleting_a_list_removes_its_cards(): void
    {
        $board = Board::factory()->create();
        $list = BoardList::factory()->create(['board_id' => $board->id]);
        $card = Card::factory()->inList($list)->create();

        $this->actingAs($board->owner)->delete("/lists/{$list->id}")->assertRedirect();

        $this->assertDatabaseMissing('board_lists', ['id' => $list->id]);
        $this->assertDatabaseMissing('cards', ['id' => $card->id]);
    }
}
