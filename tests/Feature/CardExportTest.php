<?php

namespace Tests\Feature;

use App\Http\Middleware\HandleInertiaRequests;
use App\Models\Board;
use App\Models\BoardList;
use App\Models\Card;
use App\Models\Comment;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * A prop `exportDetails`: o que a tela de exportação busca para conseguir
 * escrever descrição, checklist e comentário no texto do prompt.
 */
class CardExportTest extends TestCase
{
    use RefreshDatabase;

    private Board $board;

    private User $user;

    private BoardList $todo;

    protected function setUp(): void
    {
        parent::setUp();

        $this->board = Board::factory()->create();
        $this->user = $this->board->owner;
        $this->todo = BoardList::factory()->create(['board_id' => $this->board->id, 'position' => 1]);
    }

    public function test_the_export_detail_stays_out_of_the_first_paint(): void
    {
        Card::factory()->inList($this->todo, 1)->create();

        // Carregar descrição, checklist e comentário de todos os cards a cada
        // abertura do quadro seria pagar o preço da exportação sem usá-la.
        $this->actingAs($this->user)
            ->get("/boards/{$this->board->id}")
            ->assertInertia(fn ($page) => $page->component('boards/show')->missing('exportDetails'));
    }

    public function test_the_export_detail_carries_description_checklists_and_comments(): void
    {
        $card = Card::factory()->inList($this->todo, 1)->create(['description' => 'Precisa suportar Google.']);

        $checklist = $card->checklists()->create(['title' => 'Backend', 'position' => 1]);
        $checklist->items()->createMany([
            ['content' => 'criar rota', 'is_done' => true, 'position' => 1],
            ['content' => 'validar token', 'is_done' => false, 'position' => 2],
        ]);

        $comment = new Comment(['body' => 'Vamos de Socialite.']);
        $comment->card_id = $card->id;
        $comment->user_id = $this->user->id;
        $comment->save();

        $response = $this->exportRequest($this->user)
            ->assertOk()
            ->assertJsonPath('component', 'boards/show')
            ->assertJsonPath('props.exportDetails.0.id', $card->id)
            ->assertJsonPath('props.exportDetails.0.description', 'Precisa suportar Google.')
            ->assertJsonPath('props.exportDetails.0.checklists.0.title', 'Backend')
            ->assertJsonPath('props.exportDetails.0.checklists.0.items.0.content', 'criar rota')
            ->assertJsonPath('props.exportDetails.0.checklists.0.items.0.is_done', true)
            ->assertJsonPath('props.exportDetails.0.comments.0.author', $this->user->name)
            ->assertJsonPath('props.exportDetails.0.comments.0.body', 'Vamos de Socialite.');

        // O detalhe é um complemento do card que já veio em `board`: repetir
        // título e prazo aqui dobraria o payload sem acrescentar nada.
        $this->assertSame(
            ['id', 'description', 'checklists', 'comments'],
            array_keys($response->json('props.exportDetails.0')),
        );
    }

    public function test_archived_cards_stay_out_of_the_export(): void
    {
        Card::factory()->inList($this->todo, 1)->create(['title' => 'Viva']);
        Card::factory()->inList($this->todo, 2)->create(['title' => 'Arquivada', 'archived_at' => now()]);

        $this->exportRequest($this->user)
            ->assertOk()
            ->assertJsonCount(1, 'props.exportDetails');
    }

    public function test_someone_outside_the_board_gets_nothing(): void
    {
        Card::factory()->inList($this->todo, 1)->create();

        $this->exportRequest(User::factory()->create())->assertForbidden();
    }

    /**
     * Requisição parcial pedindo só a prop da exportação. O `X-Inertia-Version`
     * não é enfeite: sem ele a resposta é 409 e nem chega ao controller.
     */
    private function exportRequest(User $user): TestResponse
    {
        return $this->actingAs($user)
            ->withHeaders([
                'X-Inertia' => 'true',
                'X-Inertia-Version' => (new HandleInertiaRequests)->version(request()),
                'X-Inertia-Partial-Data' => 'exportDetails',
                'X-Inertia-Partial-Component' => 'boards/show',
            ])
            ->get("/boards/{$this->board->id}");
    }
}
