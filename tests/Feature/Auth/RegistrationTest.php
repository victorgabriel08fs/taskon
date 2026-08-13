<?php

namespace Tests\Feature\Auth;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RegistrationTest extends TestCase
{
    use RefreshDatabase;

    public function test_registration_screen_can_be_rendered(): void
    {
        $this->get('/register')
            ->assertOk()
            ->assertInertia(fn ($page) => $page->component('auth/register'));
    }

    public function test_new_users_can_register_and_get_a_starter_board(): void
    {
        $this->post('/register', [
            'name' => 'Victor',
            'email' => 'victor@example.com',
            'password' => 'senha-super-secreta',
            'password_confirmation' => 'senha-super-secreta',
        ])->assertRedirect('/dashboard');

        $this->assertAuthenticated();

        $user = User::firstWhere('email', 'victor@example.com');

        $this->assertNotNull($user);
        $this->assertSame(1, $user->boards()->count(), 'A conta nova deve nascer com um quadro de exemplo.');
        $this->assertGreaterThan(0, $user->boards()->first()->cards()->count());
    }

    public function test_email_must_be_unique(): void
    {
        User::factory()->create(['email' => 'ocupado@example.com']);

        $this->post('/register', [
            'name' => 'Outro',
            'email' => 'ocupado@example.com',
            'password' => 'senha-super-secreta',
            'password_confirmation' => 'senha-super-secreta',
        ])->assertSessionHasErrors('email');
    }
}
