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

/*
|--------------------------------------------------------------------------
| Arquivamento dos concluídos
|--------------------------------------------------------------------------
|
| Uma varredura por noite tira das colunas os cards concluídos há mais tempo
| que o prazo de cada quadro. Quadro sem prazo definido não é tocado — e esse
| é o padrão de todos eles.
|
| De madrugada de propósito (config/taskon.php › auto_archive.at): o card sai
| do quadro entre um expediente e outro, não debaixo do cursor de quem está
| olhando para ele. Dá para rodar na mão com `php artisan
| taskon:archive-done-cards --dry-run` para ver o que sairia.
|
*/
Schedule::command('taskon:archive-done-cards')
    ->dailyAt(config('taskon.auto_archive.at'))
    ->withoutOverlapping()
    ->runInBackground()
    ->appendOutputTo(storage_path('logs/archive-done-cards.log'));
