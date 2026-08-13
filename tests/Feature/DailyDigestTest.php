<?php

namespace Tests\Feature;

use App\Mail\DailyDigest;
use App\Models\Board;
use App\Models\BoardList;
use App\Models\Card;
use App\Models\User;
use App\Support\TaskDigest;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

class DailyDigestTest extends TestCase
{
    use RefreshDatabase;

    /** Cria um card atribuído ao usuário, num quadro de que ele é dono. */
    private function assignedCard(User $user, array $attributes = [], ?Board $board = null): Card
    {
        $board ??= Board::factory()->create(['owner_id' => $user->id]);
        $list = BoardList::factory()->create(['board_id' => $board->id]);

        $card = Card::factory()->inList($list)->create($attributes);
        $card->members()->attach($user->id);

        return $card;
    }

    public function test_it_splits_cards_between_overdue_today_and_upcoming(): void
    {
        $user = User::factory()->create();
        $board = Board::factory()->create(['owner_id' => $user->id]);

        $this->assignedCard($user, ['title' => 'Atrasado', 'due_at' => now()->subDays(2)], $board);
        $this->assignedCard($user, ['title' => 'Para hoje', 'due_at' => now()->addHours(3)], $board);
        $this->assignedCard($user, ['title' => 'Semana que vem', 'due_at' => now()->addDays(3)], $board);
        // Fora do horizonte de 7 dias: não entra em nenhuma seção.
        $this->assignedCard($user, ['title' => 'Mês que vem', 'due_at' => now()->addDays(30)], $board);
        // Sem prazo: conta como aberto, mas não aparece no e-mail.
        $this->assignedCard($user, ['title' => 'Sem prazo'], $board);

        $digest = TaskDigest::for($user);

        $this->assertSame(['Atrasado'], $digest->overdue->pluck('title')->all());
        $this->assertSame(['Para hoje'], $digest->today->pluck('title')->all());
        $this->assertSame(['Semana que vem'], $digest->upcoming->pluck('title')->all());
        $this->assertSame(5, $digest->openCount);
    }

    public function test_it_ignores_cards_of_other_people_and_of_boards_the_user_left(): void
    {
        $user = User::factory()->create();
        $other = User::factory()->create();

        // Card vencido de outra pessoa, no mesmo quadro.
        $shared = Board::factory()->create(['owner_id' => $user->id]);
        $list = BoardList::factory()->create(['board_id' => $shared->id]);
        Card::factory()->inList($list)->create(['due_at' => now()->subDay()])
            ->members()->attach($other->id);

        // Card atribuído ao usuário, mas num quadro do qual ele saiu.
        $left = Board::factory()->create(['owner_id' => $other->id]);
        $this->assignedCard($user, ['due_at' => now()->subDay()], $left);

        $digest = TaskDigest::for($user);

        $this->assertTrue($digest->isEmpty());
    }

    public function test_the_command_sends_only_to_people_with_something_to_report(): void
    {
        Mail::fake();

        $comTarefa = User::factory()->create();
        $this->assignedCard($comTarefa, ['due_at' => now()->subDay()]);

        User::factory()->create();  // sem card nenhum

        $this->artisan('taskon:daily-digest')->assertSuccessful();

        Mail::assertSentCount(1);
        Mail::assertSent(DailyDigest::class, fn (DailyDigest $mail) => $mail->hasTo($comTarefa->email));
    }

    public function test_it_respects_the_opt_out(): void
    {
        Mail::fake();

        $user = User::factory()->create(['daily_digest' => false]);
        $this->assignedCard($user, ['due_at' => now()->subDay()]);

        $this->artisan('taskon:daily-digest')->assertSuccessful();

        Mail::assertNothingSent();
    }

    public function test_it_does_not_send_twice_on_the_same_day(): void
    {
        Mail::fake();

        $user = User::factory()->create();
        $this->assignedCard($user, ['due_at' => now()->subDay()]);

        $this->artisan('taskon:daily-digest')->assertSuccessful();
        $this->artisan('taskon:daily-digest')->assertSuccessful();

        Mail::assertSentCount(1);
        $this->assertNotNull($user->fresh()->digest_last_sent_at);

        // --force existe justamente para furar a trava.
        $this->artisan('taskon:daily-digest', ['--force' => true])->assertSuccessful();
        Mail::assertSentCount(2);
    }

    public function test_dry_run_sends_nothing(): void
    {
        Mail::fake();

        $user = User::factory()->create();
        $this->assignedCard($user, ['due_at' => now()->subDay()]);

        $this->artisan('taskon:daily-digest', ['--dry-run' => true])->assertSuccessful();

        Mail::assertNothingSent();
        $this->assertNull($user->fresh()->digest_last_sent_at);
    }

    public function test_the_settings_page_previews_the_next_digest(): void
    {
        $user = User::factory()->create();
        $this->assignedCard($user, ['due_at' => now()->subDay()]);

        $this->actingAs($user)
            ->get('/settings/notifications')
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('settings/notifications')
                ->where('dailyDigest', true)
                ->where('preview.overdue', 1));
    }

    public function test_the_toggle_persists(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)
            ->patch('/settings/notifications', ['daily_digest' => false])
            ->assertRedirect();

        $this->assertFalse($user->fresh()->daily_digest);
    }

    public function test_the_test_send_does_not_consume_the_day(): void
    {
        Mail::fake();

        $user = User::factory()->create();
        $this->assignedCard($user, ['due_at' => now()->subDay()]);

        $this->actingAs($user)->post('/settings/notifications/test')->assertRedirect();
        Mail::assertSentCount(1);

        // O envio automático do dia continua de pé.
        $this->artisan('taskon:daily-digest')->assertSuccessful();
        Mail::assertSentCount(2);
    }
}
