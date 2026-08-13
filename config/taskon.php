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

    /*
    |--------------------------------------------------------------------------
    | Resumo diário por e-mail
    |--------------------------------------------------------------------------
    |
    | Enviado por `php artisan taskon:daily-digest`, agendado em
    | routes/console.php. O corte entre "vencida", "hoje" e "próximos dias" é
    | feito no fuso do app (config/app.php › timezone) — o mesmo em que as datas
    | de entrega são gravadas, senão "hoje" começaria na hora errada.
    |
    */

    'digest' => [

        // Horário do disparo. Precisa casar com o fuso do app.
        'at' => env('DIGEST_AT', '07:00'),

        // Quantos dias à frente entram em "próximos dias".
        'horizon_days' => (int) env('DIGEST_HORIZON_DAYS', 7),

        // Teto de cards listados por seção — o e-mail é um lembrete, não um relatório.
        'max_per_section' => 8,

        // Não manda e-mail para quem não tem nada vencido, para hoje, para os
        // próximos dias nem concluído nas últimas 24 h. Caixa de entrada limpa
        // vale mais que constância.
        'skip_when_empty' => true,
    ],

];
