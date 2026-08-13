<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Paleta canônica
    |--------------------------------------------------------------------------
    |
    | As chaves aqui são a fonte da verdade para validação no backend. O visual
    | correspondente vive em resources/css/app.css (classes .board-bg-* e
    | .swatch-*), porque o Tailwind precisa das classes escritas literalmente
    | no código para gerá-las.
    |
    */

    'backgrounds' => [
        'aurora',
        'sunset',
        'ocean',
        'forest',
        'candy',
        'midnight',
        'ember',
        'graphite',
    ],

    'colors' => [
        'emerald',
        'amber',
        'orange',
        'rose',
        'violet',
        'blue',
        'sky',
        'lime',
        'pink',
        'slate',
    ],

    'avatar_colors' => [
        'violet',
        'blue',
        'emerald',
        'amber',
        'rose',
        'cyan',
        'fuchsia',
        'teal',
    ],

    /*
    |--------------------------------------------------------------------------
    | Limites
    |--------------------------------------------------------------------------
    */

    'limits' => [
        'activities_per_board' => 60,
        'activities_per_card' => 20,
    ],

];
