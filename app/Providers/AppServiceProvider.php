<?php

namespace App\Providers;

use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\Vite;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        // Sem o envelope "data": o formato do prop no React é o mesmo do
        // toArray() do resource, sem uma camada extra para desembrulhar.
        JsonResource::withoutWrapping();

        // Baixa os chunks das próximas páginas assim que a atual termina de
        // carregar — navegação entre páginas fica instantânea.
        Vite::prefetch(concurrency: 3);
    }
}
