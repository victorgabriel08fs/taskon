<?php

namespace Tests\Feature;

use App\Models\Board;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class BoardTest extends TestCase
{
    use RefreshDatabase;

    public function test_the_board_list_shows_only_boards_the_user_belongs_to(): void
    {
        $user = User::factory()->create();
        $mine = Board::factory()->create(['owner_id' => $user->id, 'title' => 'Meu quadro']);
        Board::factory()->create(['title' => 'Quadro de outra pessoa']);

        $this->actingAs($user)
            ->get('/boards')
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('boards/index')
                ->has('boards', 1)
                ->where('boards.0.id', $mine->id));
    }

    public function test_creating_a_board_seeds_lists_and_labels(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)->post('/boards', [
            'title' => 'Novo quadro',
            'background' => 'ocean',
        ])->assertRedirect();

        $board = Board::firstWhere('title', 'Novo quadro');

        $this->assertNotNull($board);
        $this->assertSame(3, $board->lists()->count());
        $this->assertSame(4, $board->labels()->count());
        $this->assertSame('owner', $board->members()->where('users.id', $user->id)->value('board_user.role'));
    }

    public function test_non_members_cannot_open_a_board(): void
    {
        $board = Board::factory()->create();
        $stranger = User::factory()->create();

        $this->actingAs($stranger)->get("/boards/{$board->id}")->assertForbidden();
    }

    public function test_members_can_open_a_board(): void
    {
        $board = Board::factory()->create();
        $member = User::factory()->create();
        $board->members()->attach($member->id, ['role' => 'member']);

        $this->actingAs($member)
            ->get("/boards/{$board->id}")
            ->assertOk()
            ->assertInertia(fn ($page) => $page->component('boards/show')->where('board.id', $board->id));
    }

    public function test_plain_members_cannot_change_board_settings(): void
    {
        $board = Board::factory()->create(['background' => 'aurora']);
        $member = User::factory()->create();
        $board->members()->attach($member->id, ['role' => 'member']);

        $this->actingAs($member)
            ->patch("/boards/{$board->id}", ['background' => 'ember'])
            ->assertForbidden();

        $this->assertSame('aurora', $board->fresh()->background);
    }

    public function test_only_the_owner_can_delete_a_board(): void
    {
        $board = Board::factory()->create();
        $admin = User::factory()->create();
        $board->members()->attach($admin->id, ['role' => 'admin']);

        $this->actingAs($admin)->delete("/boards/{$board->id}")->assertForbidden();

        $this->actingAs($board->owner)->delete("/boards/{$board->id}")->assertRedirect('/boards');
        $this->assertDatabaseMissing('boards', ['id' => $board->id]);
    }

    public function test_favorite_toggles_per_user(): void
    {
        $board = Board::factory()->create();
        $owner = $board->owner;

        $this->actingAs($owner)->post("/boards/{$board->id}/favorite")->assertRedirect();
        $this->assertTrue((bool) $owner->boards()->where('boards.id', $board->id)->value('board_user.is_favorite'));

        $this->actingAs($owner)->post("/boards/{$board->id}/favorite");
        $this->assertFalse((bool) $owner->boards()->where('boards.id', $board->id)->value('board_user.is_favorite'));
    }
}
