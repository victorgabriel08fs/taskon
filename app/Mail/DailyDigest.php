<?php

namespace App\Mail;

use App\Support\TaskDigest;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Mail\Mailables\Headers;
use Illuminate\Queue\SerializesModels;

/**
 * O resumo diário.
 *
 * NÃO implementa ShouldQueue de propósito: o comando que dispara já roda fora
 * do ciclo de request, e enfileirar aqui exigiria um worker de pé só para isso.
 * Se um dia o volume justificar, troque para ShouldQueue e suba o serviço
 * taskon-queue que está comentado no docker-compose.yml.
 */
class DailyDigest extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(public readonly TaskDigest $digest) {}

    public function envelope(): Envelope
    {
        $overdue = $this->digest->overdue->count();
        $today = $this->digest->today->count();

        // O assunto é a parte que mais gente lê. Ele carrega o número que
        // importa em vez de repetir "Resumo diário" todo dia.
        $subject = match (true) {
            $overdue > 0 => '⏰ '.self::plural($overdue, 'tarefa vencida', 'tarefas vencidas'),
            $today > 0 => '📌 '.self::plural($today, 'tarefa vence hoje', 'tarefas vencem hoje'),
            $this->digest->upcoming->isNotEmpty() => '📅 '.self::plural($this->digest->upcoming->count(), 'tarefa no radar', 'tarefas no radar'),
            default => '✅ Você fechou o dia sem pendências',
        };

        return new Envelope(
            subject: $subject.' · '.$this->digest->now->locale('pt_BR')->translatedFormat('d \d\e M'),
        );
    }

    public function headers(): Headers
    {
        // Cabeçalho padrão (RFC 8058) que faz o Gmail mostrar "Cancelar
        // inscrição" ao lado do remetente. Sem ele, quem quer sair marca como
        // spam — e queima a reputação do domínio no Resend.
        return new Headers(text: [
            'List-Unsubscribe' => '<'.route('notifications.edit').'>',
        ]);
    }

    public function content(): Content
    {
        return new Content(
            view: 'mail.daily-digest',
            with: [
                'user' => $this->digest->user,
                'now' => $this->digest->now,
                'sections' => $this->digest->sections(),
                'completed' => $this->digest->completed,
                'openCount' => $this->digest->openCount,
                'dashboardUrl' => route('dashboard'),
                'settingsUrl' => route('notifications.edit'),
            ],
        );
    }

    private static function plural(int $count, string $singular, string $plural): string
    {
        return $count.' '.($count === 1 ? $singular : $plural);
    }
}
