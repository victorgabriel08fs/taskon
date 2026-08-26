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

        // Teto da tela de arquivados. Ela é uma gaveta de resgate, não um
        // relatório: quem precisa de tudo exporta o quadro.
        'archived_per_board' => 100,
    ],

    /*
    |--------------------------------------------------------------------------
    | Arquivamento automático dos concluídos
    |--------------------------------------------------------------------------
    |
    | Cada quadro escolhe em quantos dias um card concluído sai da coluna
    | (boards.auto_archive_done_after_days). Sem prazo definido, nada é
    | arquivado — o padrão de todo quadro é ficar desligado.
    |
    | Quem executa é `php artisan taskon:archive-done-cards`, agendado em
    | routes/console.php e disparado pelo serviço 'taskon-scheduler'. Arquivar
    | não apaga: o card continua no banco com archived_at, sai das colunas e
    | volta pela tela de arquivados.
    |
    */

    'auto_archive' => [

        // Horário da varredura, no fuso do app. De madrugada de propósito: o
        // card some entre um expediente e outro, não debaixo do cursor de quem
        // está trabalhando nele.
        'at' => env('AUTO_ARCHIVE_AT', '03:00'),

        // Prazos oferecidos na tela — e a lista canônica que o backend valida.
        // Ausência de prazo (null) é sempre aceita e significa "desligado".
        'options' => [1, 3, 7, 14, 30],
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
