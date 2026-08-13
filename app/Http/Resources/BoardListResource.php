<?php

namespace App\Http\Resources;

use App\Models\BoardList;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin BoardList */
class BoardListResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'title' => $this->title,
            'position' => $this->position,
            'card_limit' => $this->card_limit,
            'is_done' => (bool) $this->is_done,
            'cards' => CardResource::collection($this->whenLoaded('cards')),
        ];
    }
}
