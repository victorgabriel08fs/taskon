<?php

namespace App\Http\Resources;

use App\Models\Card;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * O card visto da gaveta: só o que a tela de arquivados precisa para a pessoa
 * reconhecê-lo e decidir se o traz de volta.
 *
 * Nada de etiquetas, membros ou contadores — a gaveta pode ter cem linhas, e
 * carregar o card inteiro em cada uma custaria mais que a tela vale. Quem
 * quiser o resto restaura e abre o card.
 *
 * @mixin Card
 */
class ArchivedCardResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'title' => $this->title,
            'list_title' => $this->whenLoaded('list', fn () => $this->list?->title, null),
            'due_at' => $this->due_at?->toIso8601String(),
            'completed_at' => $this->completed_at?->toIso8601String(),
            'archived_at' => $this->archived_at?->toIso8601String(),
        ];
    }
}
