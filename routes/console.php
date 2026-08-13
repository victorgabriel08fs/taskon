<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

/*
|--------------------------------------------------------------------------
| Resumo diário
|--------------------------------------------------------------------------
|
| Quem chama o agendador é o serviço 'taskon-scheduler' do docker-compose
| (php artisan schedule:work). Sem ele nada dispara sozinho — dá para rodar
| na mão com `php artisan taskon:daily-digest`.
|
| O horário está no fuso do app (America/Sao_Paulo). withoutOverlapping evita
| dois envios simultâneos se uma rodada demorar mais que a próxima janela.
|
*/
Schedule::command('taskon:daily-digest')
    ->dailyAt(config('taskon.digest.at'))
    ->withoutOverlapping()
    ->runInBackground()
    ->appendOutputTo(storage_path('logs/daily-digest.log'));
