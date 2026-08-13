<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\Pivot;

/**
 * Pivot de board_user — existe para dar casts ao papel/favorito/último acesso.
 */
class BoardMember extends Pivot
{
    protected $table = 'board_user';

    public $incrementing = true;

    protected function casts(): array
    {
        return [
            'is_favorite' => 'boolean',
            'last_opened_at' => 'datetime',
        ];
    }
}
