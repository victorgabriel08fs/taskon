<?php

namespace App\Http\Resources;

use App\Models\Board;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Board */
class BoardResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $user = $request->user();

        $membership = $this->relationLoaded('members') && $user
            ? $this->members->firstWhere('id', $user->getKey())
            : null;

        return [
            'id' => $this->id,
            'title' => $this->title,
            'description' => $this->description,
            'background' => $this->background,
            'owner_id' => $this->owner_id,
            'is_favorite' => (bool) $membership?->pivot->is_favorite,
            'role' => $membership?->pivot->role,

            // Dias até um concluído sair da coluna; null = desligado.
            'auto_archive_days' => $this->auto_archive_done_after_days,

            // Depende do loadCount do BoardController::show. Sem ele o menu
            // mostraria "Arquivados" sempre vazio, em silêncio.
            'archived_count' => (int) ($this->archived_cards_count ?? 0),
            'can' => [
                'manage' => (bool) $user?->can('manage', $this->resource),
                'delete' => (bool) $user?->can('delete', $this->resource),
            ],
            'members' => UserResource::collection($this->whenLoaded('members')),
            'labels' => LabelResource::collection($this->whenLoaded('labels')),
            'lists' => BoardListResource::collection($this->whenLoaded('lists')),
        ];
    }
}
