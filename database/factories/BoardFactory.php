<?php

namespace Database\Factories;

use App\Models\Board;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Board>
 */
class BoardFactory extends Factory
{
    /** @return array<string, mixed> */
    public function definition(): array
    {
        return [
            'owner_id' => User::factory(),
            'title' => fake()->words(3, true),
            'description' => fake()->optional()->sentence(),
            'background' => fake()->randomElement(config('taskon.backgrounds')),
        ];
    }

    /**
     * Cria o quadro já com o dono na tabela de membros — é o estado real
     * de qualquer quadro criado pela aplicação.
     */
    public function configure(): static
    {
        return $this->afterCreating(function (Board $board) {
            $board->members()->syncWithoutDetaching([
                $board->owner_id => ['role' => 'owner'],
            ]);
        });
    }
}
