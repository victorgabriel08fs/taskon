<?php

namespace App\Http\Resources;

use App\Models\Activity;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Activity */
class ActivityResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'type' => $this->type,
            'description' => $this->description,
            'properties' => $this->properties,
            'created_at' => $this->created_at?->toIso8601String(),
            'user' => new UserResource($this->whenLoaded('user')),

            // Só o painel carrega o quadro: lá o feed mistura vários, e sem o
            // nome a linha fica sem contexto. No quadro a chave nem existe.
            'board' => $this->whenLoaded('board', fn () => [
                'id' => $this->board->id,
                'title' => $this->board->title,
                'background' => $this->board->background,
            ]),
        ];
    }
}
