<?php

namespace App\Support;

use App\Models\Activity;
use App\Models\Board;
use App\Models\Card;
use Illuminate\Support\Facades\Auth;

class ActivityLogger
{
    /**
     * Registra um evento no feed do quadro (e opcionalmente do card).
     *
     * @param  array<string, mixed>  $properties
     */
    public static function log(
        Board $board,
        string $type,
        string $description,
        ?Card $card = null,
        array $properties = [],
    ): Activity {
        return Activity::forceCreate([
            'board_id' => $board->getKey(),
            'card_id' => $card?->getKey(),
            'user_id' => Auth::id(),
            'type' => $type,
            'description' => $description,
            'properties' => $properties ?: null,
        ]);
    }
}
