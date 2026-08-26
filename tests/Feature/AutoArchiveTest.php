<?php

namespace Tests\Feature;

use App\Http\Middleware\HandleInertiaRequests;
use App\Models\Board;
use App\Models\BoardList;
use App\Models\Card;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * O arquivamento automático dos concluídos.
 *
 * A coluna "Concluído" cresce sem parar e acaba abafando o que falta. Cada
 * quadro escolhe um prazo, e a varredura da madrugada tira de lá o que já
 * passou dele.
 *
 * Duas coisas se testam aqui com o mesmo peso: que o card SOME do quadro e que
 * ele NÃO some do histórico. A segunda é a que quebra em silêncio — o painel
 * afundaria sozinho no dia em que alguém ligasse o recurso.
 */
class AutoArchiveTest extends TestCase
{
    use RefreshDatabase;

    private Board $board;

    private User $user;

    private BoardList $todo;

    private BoardList $done;

    protected function setUp(): void
    {
        parent::setUp();

        $this->board = Board::factory()->create(['auto_archive_done_after_days' => 7]);
        $this->user = $this->board->owner;
        $this->todo = BoardList::factory()->create([
            'board_id' => $this->board->id,
            'title' => 'A fazer',
            'position' => 1,
        ]);
        $this->done = BoardList::factory()->create([
            'board_id' => $this->board->id,
            'title' => 'Concluído',
            'position' => 2,
            'is_done' => true,
        ]);
    }

    private function sweep(array $options = []): void
    {
        $this->artisan('taskon:archive-done-cards', $options)->assertSuccessful();
    }

    /* ------------------------------------------------------------ a varredura */

    public function test_it_archives_what_passed_the_deadline_and_leaves_the_rest(): void
    {
        $velho = Card::factory()->inList($this->done)->create(['completed_at' => now()->subDays(8)]);
        $novo = Card::factory()->inList($this->done)->create(['completed_at' => now()->subDays(2)]);

        $this->sweep();

        $this->assertNotNull($velho->fresh()->archived_at);
        $this->assertNull($novo->fresh()->archived_at, 'dentro do prazo o card fica');
    }

    public function test_an_open_card_is_never_archived_no_matter_how_old(): void
    {
        // Sem completed_at não há relógio para correr: esquecer uma tarefa não
        // pode ser jeito de se livrar dela.
        $esquecido = Card::factory()->inList($this->todo)->create([
            'created_at' => now()->subYear(),
            'due_at' => now()->subMonths(6),
        ]);

        $this->sweep();

        $this->assertNull($esquecido->fresh()->archived_at);
    }

    public function test_a_board_without_a_deadline_is_never_touched(): void
    {
        $this->board->update(['auto_archive_done_after_days' => null]);
        $card = Card::factory()->inList($this->done)->create(['completed_at' => now()->subYear()]);

        $this->sweep();

        $this->assertNull($card->fresh()->archived_at);
    }

    public function test_the_dry_run_archives_nothing(): void
    {
        $card = Card::factory()->inList($this->done)->create(['completed_at' => now()->subDays(30)]);

        $this->sweep(['--dry-run' => true]);

        $this->assertNull($card->fresh()->archived_at);
    }

    public function test_the_board_option_scopes_the_sweep(): void
    {
        $outro = Board::factory()->create(['auto_archive_done_after_days' => 1]);
        $lista = BoardList::factory()->create(['board_id' => $outro->id]);
        $deFora = Card::factory()->inList($lista)->create(['completed_at' => now()->subDays(30)]);
        $daqui = Card::factory()->inList($this->done)->create(['completed_at' => now()->subDays(30)]);

        $this->sweep(['--board' => $this->board->id]);

        $this->assertNotNull($daqui->fresh()->archived_at);
        $this->assertNull($deFora->fresh()->archived_at);
    }

    public function test_the_sweep_leaves_one_line_in_the_history_not_one_per_card(): void
    {
        Card::factory()->count(3)->inList($this->done)->create(['completed_at' => now()->subDays(10)]);

        $this->sweep();

        $this->assertSame(1, $this->board->activities()->where('type', 'cards.auto_archived')->count());
    }

    /* -------------------------------------------------------------- o quadro */

    public function test_an_archived_card_leaves_the_board_payload(): void
    {
        Card::factory()->inList($this->done)->create(['completed_at' => now()->subDays(10)]);
        Card::factory()->inList($this->todo)->create();

        $this->sweep();

        $this->actingAs($this->user)
            ->get("/boards/{$this->board->id}")
            ->assertInertia(fn ($page) => $page
                ->has('board.lists.0.cards', 1)
                ->has('board.lists.1.cards', 0)
                ->where('board.archived_count', 1)
                ->where('board.auto_archive_days', 7));
    }

    public function test_the_archived_drawer_is_only_loaded_when_asked_for(): void
    {
        Card::factory()->inList($this->done)->create(['completed_at' => now()->subDays(10)]);
        $this->sweep();

        $this->actingAs($this->user)
            ->get("/boards/{$this->board->id}")
            ->assertInertia(fn ($page) => $page->missing('archivedCards'));

        $this->actingAs($this->user)
            ->withHeaders([
                'X-Inertia' => 'true',
                'X-Inertia-Version' => (new HandleInertiaRequests)->version(request()),
                'X-Inertia-Partial-Data' => 'archivedCards',
                'X-Inertia-Partial-Component' => 'boards/show',
            ])
            ->get("/boards/{$this->board->id}")
            ->assertOk()
            ->assertJsonCount(1, 'props.archivedCards')
            ->assertJsonPath('props.archivedCards.0.list_title', 'Concluído');
    }

    /* ---------------------------------------------------- histórico e painel */

    public function test_archiving_does_not_undo_the_progress_of_the_board(): void
    {
        // Quadro fechado: dez tarefas, dez concluídas há muito tempo. Depois da
        // varredura o painel tem de continuar dizendo 10 de 10 — e não 0 de 0,
        // que seria a leitura de quem some com o card e com a conquista junto.
        Card::factory()->count(10)->inList($this->done)->create(['completed_at' => now()->subDays(20)]);

        $antes = fn () => $this->actingAs($this->user)->get('/dashboard');

        $antes()->assertInertia(fn ($page) => $page
            ->where('boards.0.total', 10)
            ->where('boards.0.done', 10));

        $this->sweep();

        $antes()->assertInertia(fn ($page) => $page
            ->where('boards.0.total', 10)
            ->where('boards.0.done', 10));

        $this->actingAs($this->user)
            ->get('/boards')
            ->assertInertia(fn ($page) => $page
                ->where('boards.0.cards_count', 10)
                ->where('boards.0.done_count', 10));
    }

    public function test_an_archived_completion_still_counts_in_the_week(): void
    {
        $this->board->update(['auto_archive_done_after_days' => 1]);

        $card = Card::factory()->inList($this->done)->create(['completed_at' => now()->subDays(3)]);
        $card->members()->attach($this->user->id);

        $this->sweep();

        // Concluída há 3 dias e arquivada hoje: continua sendo uma entrega
        // desta semana, e o gráfico de ritmo continua tendo o dia dela.
        $this->actingAs($this->user)
            ->get('/dashboard')
            ->assertInertia(fn ($page) => $page
                ->where('stats.completed_week', 1)
                // A soma, e não um dia fixo: o que importa é a conclusão não
                // ter evaporado do gráfico, não em qual barra ela caiu.
                ->where('trend', fn ($trend) => $trend->sum('completed') === 1));
    }

    public function test_an_archived_card_is_not_an_open_task_anymore(): void
    {
        $card = Card::factory()->inList($this->done)->create([
            'completed_at' => now()->subDays(10),
            'due_at' => now()->subDays(20),
        ]);
        $card->members()->attach($this->user->id);

        $this->sweep();

        $this->actingAs($this->user)
            ->get('/dashboard')
            ->assertInertia(fn ($page) => $page
                ->where('stats.overdue', 0)
                ->where('stats.open', 0)
                ->where('boards.0.overdue', 0)
                ->has('deadlines', 0));
    }

    /* ------------------------------------------------------- arquivar na mão */

    public function test_a_card_can_be_archived_by_hand_without_being_done(): void
    {
        $card = Card::factory()->inList($this->todo)->create();

        $this->actingAs($this->user)
            ->post("/cards/{$card->id}/archive")
            // Redirect para o quadro, não back(): a URL anterior pode ser a do
            // próprio card, e voltar para lá reabriria o modal de um arquivado.
            ->assertRedirect("/boards/{$this->board->id}");

        $this->assertNotNull($card->fresh()->archived_at);
        $this->assertNull($card->fresh()->completed_at);
    }

    public function test_archive_now_runs_the_same_sweep(): void
    {
        $velho = Card::factory()->inList($this->done)->create(['completed_at' => now()->subDays(8)]);
        $novo = Card::factory()->inList($this->done)->create(['completed_at' => now()->subDays(2)]);

        $this->actingAs($this->user)
            ->post("/boards/{$this->board->id}/archive-done")
            ->assertRedirect();

        $this->assertNotNull($velho->fresh()->archived_at);
        $this->assertNull($novo->fresh()->archived_at);
    }

    public function test_archive_now_does_nothing_without_a_deadline(): void
    {
        $this->board->update(['auto_archive_done_after_days' => null]);
        $card = Card::factory()->inList($this->done)->create(['completed_at' => now()->subYear()]);

        $this->actingAs($this->user)->post("/boards/{$this->board->id}/archive-done")->assertRedirect();

        $this->assertNull($card->fresh()->archived_at);
    }

    /* ------------------------------------------------------------- restaurar */

    public function test_restoring_reopens_the_card_and_takes_it_out_of_the_done_column(): void
    {
        $card = Card::factory()->inList($this->done)->create([
            'completed_at' => now()->subDays(10),
            'archived_at' => now(),
        ]);

        $this->actingAs($this->user)->post("/cards/{$card->id}/restore")->assertRedirect();

        $card->refresh();

        $this->assertNull($card->archived_at);
        // Voltar ainda concluído faria a varredura levá-lo de novo na madrugada
        // seguinte, e a pessoa restauraria o mesmo card todo dia.
        $this->assertNull($card->completed_at, 'restaurar reabre o card');
        $this->assertSame($this->todo->id, $card->board_list_id, 'não volta para a coluna dos prontos');
    }

    public function test_restoring_from_an_ordinary_column_keeps_the_card_where_it_was(): void
    {
        $card = Card::factory()->inList($this->todo)->create(['archived_at' => now()]);

        $this->actingAs($this->user)->post("/cards/{$card->id}/restore")->assertRedirect();

        $this->assertSame($this->todo->id, $card->fresh()->board_list_id);
    }

    public function test_the_restored_card_goes_to_the_end_of_the_queue(): void
    {
        Card::factory()->inList($this->todo, position: 1)->create();
        Card::factory()->inList($this->todo, position: 2)->create();
        $card = Card::factory()->inList($this->done)->create([
            'completed_at' => now()->subDays(10),
            'archived_at' => now(),
        ]);

        $this->actingAs($this->user)->post("/cards/{$card->id}/restore");

        $this->assertSame(3.0, $card->fresh()->position);
    }

    public function test_restoring_gives_the_drawer_back_in_the_same_round_trip(): void
    {
        $card = Card::factory()->inList($this->done)->create([
            'completed_at' => now()->subDays(10),
            'archived_at' => now(),
        ]);
        $vizinho = Card::factory()->inList($this->done)->create([
            'completed_at' => now()->subDays(10),
            'archived_at' => now(),
        ]);

        // `archivedCards` é prop `optional`: ela só existe se o cabeçalho
        // parcial sobreviver ao redirect do POST. Se não sobrevivesse, a tela
        // ficaria presa no esqueleto de carregamento depois de cada
        // restauração — e o bug seria invisível daqui.
        $this->actingAs($this->user)
            ->withHeaders([
                'X-Inertia' => 'true',
                'X-Inertia-Version' => (new HandleInertiaRequests)->version(request()),
                'X-Inertia-Partial-Data' => 'board,archivedCards',
                'X-Inertia-Partial-Component' => 'boards/show',
            ])
            ->from("/boards/{$this->board->id}")
            ->followingRedirects()
            ->post("/cards/{$card->id}/restore")
            ->assertOk()
            ->assertJsonCount(1, 'props.archivedCards')
            ->assertJsonPath('props.archivedCards.0.id', $vizinho->id)
            ->assertJsonPath('props.board.archived_count', 1);
    }

    public function test_restoring_a_card_that_is_not_archived_is_a_404(): void
    {
        $card = Card::factory()->inList($this->todo)->create();

        $this->actingAs($this->user)->post("/cards/{$card->id}/restore")->assertNotFound();
    }

    /* ------------------------------------------------------------- o ajuste */

    public function test_the_deadline_only_accepts_the_configured_options(): void
    {
        $this->actingAs($this->user)
            ->patch("/boards/{$this->board->id}", ['auto_archive_done_after_days' => 5])
            ->assertSessionHasErrors('auto_archive_done_after_days');

        $this->assertSame(7, $this->board->fresh()->auto_archive_done_after_days);
    }

    public function test_null_turns_the_deadline_off_and_the_history_records_it(): void
    {
        $this->actingAs($this->user)
            ->patch("/boards/{$this->board->id}", ['auto_archive_done_after_days' => null])
            ->assertRedirect();

        $this->assertNull($this->board->fresh()->auto_archive_done_after_days);
        $this->assertSame(1, $this->board->activities()->where('type', 'board.auto_archive')->count());
    }

    public function test_a_plain_member_cannot_change_the_deadline(): void
    {
        $member = User::factory()->create();
        $this->board->members()->attach($member->id, ['role' => 'member']);

        $this->actingAs($member)
            ->patch("/boards/{$this->board->id}", ['auto_archive_done_after_days' => 30])
            ->assertForbidden();

        $this->actingAs($member)
            ->post("/boards/{$this->board->id}/archive-done")
            ->assertForbidden();

        $this->assertSame(7, $this->board->fresh()->auto_archive_done_after_days);
    }

    public function test_outsiders_cannot_archive_or_restore(): void
    {
        $card = Card::factory()->inList($this->done)->create(['completed_at' => now()->subDays(10)]);
        $stranger = User::factory()->create();

        $this->actingAs($stranger)->post("/cards/{$card->id}/archive")->assertForbidden();
        $this->actingAs($stranger)->post("/cards/{$card->id}/restore")->assertForbidden();
    }
}
