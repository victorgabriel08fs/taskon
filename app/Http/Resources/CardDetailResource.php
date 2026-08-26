<?php

namespace App\Http\Resources;

use App\Models\Card;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Card */
class CardDetailResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'board_id' => $this->board_id,
            'board_list_id' => $this->board_list_id,
            'list_title' => $this->whenLoaded('list', fn () => $this->list->title),
            'title' => $this->title,
            'description' => $this->description,
            'cover_color' => $this->cover_color,
            'due_at' => $this->due_at?->toIso8601String(),
            'completed_at' => $this->completed_at?->toIso8601String(),

            // O deep link de um card arquivado continua abrindo (F5 numa aba
            // velha, um link colado no chat). Sem este campo o modal fingiria
            // que o card está na coluna, e a pessoa procuraria por ele em vão.
            'archived_at' => $this->archived_at?->toIso8601String(),
            'created_at' => $this->created_at?->toIso8601String(),
            'label_ids' => $this->whenLoaded('labels', fn () => $this->labels->pluck('id')->all(), []),
            'member_ids' => $this->whenLoaded('members', fn () => $this->members->pluck('id')->all(), []),
            'comments' => CommentResource::collection($this->whenLoaded('comments')),
            'checklists' => ChecklistResource::collection($this->whenLoaded('checklists')),
            'activities' => ActivityResource::collection($this->whenLoaded('activities')),
        ];
    }
}
