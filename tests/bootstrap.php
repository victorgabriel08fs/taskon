<?php

/*
|--------------------------------------------------------------------------
| Bootstrap dos testes
|--------------------------------------------------------------------------
|
| Existe para resolver um problema específico e destrutivo: dentro do container
| o docker-compose.yml exporta DB_DATABASE=taskon e MAIL_MAILER=smtp como
| variáveis de ambiente DE VERDADE.
|
| O bloco <php> do phpunit.xml não vence isso. Mesmo com force="true", ele só
| sobrescreve putenv() e $_ENV — o $_SERVER continua com o valor do Docker, e é
| do $_SERVER que o env() do Laravel lê primeiro:
|
|     env(DB_DATABASE)='taskon'  getenv='taskon_test'  $_ENV='taskon_test'  $_SERVER='taskon'
|
| Consequência real, verificada: `docker compose exec taskon-app php artisan test`
| rodava RefreshDatabase no banco de DESENVOLVIMENTO e apagava tudo — sem erro,
| sem aviso. E os e-mails dos testes iam para o Mailpit de verdade.
|
| Ao acrescentar uma variável nova ao docker-compose.yml, confira se ela precisa
| entrar nesta lista.
|
*/

$overrides = [
    'APP_ENV' => 'testing',
    'DB_CONNECTION' => 'mysql',
    'DB_DATABASE' => 'taskon_test',
    'MAIL_MAILER' => 'array',
    'CACHE_STORE' => 'array',
    'SESSION_DRIVER' => 'array',
    'QUEUE_CONNECTION' => 'sync',
];

foreach ($overrides as $key => $value) {
    putenv("{$key}={$value}");
    $_ENV[$key] = $value;
    $_SERVER[$key] = $value;
}

require __DIR__.'/../vendor/autoload.php';
