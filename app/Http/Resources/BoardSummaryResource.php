<?php

namespace App\Http\Resources;

use App\Models\Board;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Board */
class BoardSummaryResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'title' => $this->title,
            'description' => $this->description,
            'background' => $this->background,
            'is_favorite' => (bool) $this->pivot?->is_favorite,
            'role' => $this->pivot?->role,
            'last_opened_at' => $this->pivot?->last_opened_at?->toIso8601String(),
            'lists_count' => (int) ($this->lists_count ?? 0),
            'cards_count' => (int) ($this->cards_count ?? 0),
            'done_count' => (int) ($this->cards_done_count ?? 0),
            'members' => UserResource::collection($this->whenLoaded('members')),
        ];
    }
}
