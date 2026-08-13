<?php

namespace Database\Factories;

use App\Models\Board;
use App\Models\BoardList;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<BoardList>
 */
class BoardListFactory extends Factory
{
    /** @return array<string, mixed> */
    public function definition(): array
    {
        return [
            'board_id' => Board::factory(),
            'title' => fake()->word(),
            'position' => fake()->numberBetween(1, 10),
        ];
    }
}
