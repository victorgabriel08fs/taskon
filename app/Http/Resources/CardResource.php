<?php

namespace App\Http\Resources;

use App\Models\Card;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Versão "leve" do card — o que o Kanban precisa para desenhar a coluna.
 * O detalhe completo vai em CardDetailResource, carregado só ao abrir o card.
 *
 * @mixin Card
 */
class CardResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'board_list_id' => $this->board_list_id,
            'title' => $this->title,
            'position' => $this->position,
            'cover_color' => $this->cover_color,
            'due_at' => $this->due_at?->toIso8601String(),
            'completed_at' => $this->completed_at?->toIso8601String(),
            'has_description' => filled($this->description),
            'label_ids' => $this->whenLoaded('labels', fn () => $this->labels->pluck('id')->all(), []),
            'member_ids' => $this->whenLoaded('members', fn () => $this->members->pluck('id')->all(), []),
            'comments_count' => (int) ($this->comments_count ?? 0),
            'checklist_total' => (int) ($this->checklist_items_count ?? 0),
            'checklist_done' => (int) ($this->checklist_items_done_count ?? 0),
        ];
    }
}
