<?php

namespace App\Http\Resources;

use App\Models\Card;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Um card visto de fora do quadro: no painel ele precisa dizer de onde veio,
 * porque a lista mistura quadros diferentes.
 *
 * @mixin Card
 */
class DeadlineResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'title' => $this->title,
            'due_at' => $this->due_at?->toIso8601String(),
            'completed_at' => $this->completed_at?->toIso8601String(),
            'board_id' => $this->board_id,
            'board_title' => $this->board->title,
            'board_background' => $this->board->background,
            'list_title' => $this->list->title,
        ];
    }
}
