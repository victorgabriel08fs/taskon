<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['content', 'is_done', 'position'])]
class ChecklistItem extends Model
{
    protected function casts(): array
    {
        return [
            'is_done' => 'boolean',
            'position' => 'float',
        ];
    }

    /** @return BelongsTo<Checklist, $this> */
    public function checklist(): BelongsTo
    {
        return $this->belongsTo(Checklist::class);
    }
}
