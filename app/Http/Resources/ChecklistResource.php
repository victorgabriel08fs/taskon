<?php

namespace App\Http\Resources;

use App\Models\Checklist;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Checklist */
class ChecklistResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'title' => $this->title,
            'position' => $this->position,
            'items' => $this->whenLoaded('items', fn () => $this->items->map(fn ($item) => [
                'id' => $item->id,
                'content' => $item->content,
                'is_done' => $item->is_done,
                'position' => $item->position,
            ])->all()),
        ];
    }
}
