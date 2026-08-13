<?php

namespace App\Http\Resources;

use App\Models\Board;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * O quadro reduzido a três números. Espera os withCount do
 * DashboardController — sem eles tudo vira zero, em silêncio.
 *
 * @mixin Board
 */
class BoardProgressResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'title' => $this->title,
            'background' => $this->background,
            'total' => (int) ($this->total_count ?? 0),
            'done' => (int) ($this->done_count ?? 0),
            'overdue' => (int) ($this->overdue_count ?? 0),
        ];
    }
}
