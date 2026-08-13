<?php

namespace App\Http\Controllers\Settings;

use App\Http\Controllers\Controller;
use App\Mail\DailyDigest;
use App\Support\TaskDigest;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Mail;
use Inertia\Inertia;
use Inertia\Response;
use Throwable;

class NotificationController extends Controller
{
    public function edit(Request $request): Response
    {
        // A prévia mostra o que o próximo resumo diria HOJE. Sem ela a tela
        // seria um interruptor sem contexto — e ninguém liga um alerta sem
        // saber o que ele vai gritar.
        $digest = TaskDigest::for($request->user());

        return Inertia::render('settings/notifications', [
            'dailyDigest' => (bool) $request->user()->daily_digest,
            'lastSentAt' => $request->user()->digest_last_sent_at?->toIso8601String(),
            'sendAt' => config('taskon.digest.at'),
            'horizonDays' => config('taskon.digest.horizon_days'),
            'preview' => [
                'overdue' => $digest->overdue->count(),
                'today' => $digest->today->count(),
                'upcoming' => $digest->upcoming->count(),
                'completed' => $digest->completed->count(),
                'open' => $digest->openCount,
            ],
        ]);
    }

    public function update(Request $request): RedirectResponse
    {
        $validated = $request->validate([
            'daily_digest' => ['required', 'boolean'],
        ]);

        $request->user()->update($validated);

        Inertia::flash('toast', [
            'type' => 'success',
            'message' => $validated['daily_digest']
                ? 'Resumo diário ativado.'
                : 'Resumo diário desativado.',
        ]);

        return back();
    }

    /**
     * Manda o resumo agora, para a própria pessoa.
     *
     * Não carimba digest_last_sent_at de propósito: o teste não pode fazer o
     * envio real do dia ser pulado.
     */
    public function test(Request $request): RedirectResponse
    {
        try {
            Mail::to($request->user())->send(
                new DailyDigest(TaskDigest::for($request->user()))
            );
        } catch (Throwable $e) {
            Inertia::flash('toast', [
                'type' => 'error',
                'message' => 'Não consegui enviar: '.$e->getMessage(),
            ]);

            return back();
        }

        Inertia::flash('toast', [
            'type' => 'success',
            'message' => "Resumo enviado para {$request->user()->email}.",
        ]);

        return back();
    }
}
