<?php

namespace Database\Factories;

use App\Models\BoardList;
use App\Models\Card;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Card>
 */
class CardFactory extends Factory
{
    /** @return array<string, mixed> */
    public function definition(): array
    {
        $list = BoardList::factory();

        return [
            'board_list_id' => $list,
            'board_id' => fn (array $attributes) => BoardList::find($attributes['board_list_id'])->board_id,
            'title' => fake()->sentence(4),
            'position' => fake()->numberBetween(1, 20),
        ];
    }

    public function inList(BoardList $list, float $position = 1): static
    {
        return $this->state([
            'board_list_id' => $list->id,
            'board_id' => $list->board_id,
            'position' => $position,
        ]);
    }
}
