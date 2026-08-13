{{--
    Resumo diário.

    HTML de e-mail é HTML de 2005 de propósito: tabelas, largura fixa e todo
    estilo inline. Gmail, Outlook e afins descartam <style> externo, flexbox e
    boa parte de CSS moderno — o que sobra é isto. Nada de imagem remota
    também: quase todo cliente bloqueia por padrão e o layout cairia.
--}}
@php
    /** Cor da borda e do fundo de cada seção. */
    $tones = [
        'danger' => ['bar' => '#dc2626', 'chip' => '#fef2f2', 'text' => '#b91c1c'],
        'warning' => ['bar' => '#d97706', 'chip' => '#fffbeb', 'text' => '#b45309'],
        'neutral' => ['bar' => '#7c3aed', 'chip' => '#f5f3ff', 'text' => '#6d28d9'],
    ];

    $dueLabel = function (\App\Models\Card $card) use ($now): string {
        $due = $card->due_at->locale('pt_BR');

        if ($due->lt($now)) {
            return 'venceu '.$due->diffForHumans($now);
        }

        if ($due->isSameDay($now)) {
            return 'hoje às '.$due->format('H:i');
        }

        if ($due->isSameDay($now->addDay())) {
            return 'amanhã às '.$due->format('H:i');
        }

        return $due->translatedFormat('D, d \d\e M').' às '.$due->format('H:i');
    };

    $stats = [
        ['label' => 'Vencidas', 'value' => $digest->overdue->count(), 'color' => '#dc2626'],
        ['label' => 'Hoje', 'value' => $digest->today->count(), 'color' => '#d97706'],
        ['label' => 'Em aberto', 'value' => $openCount, 'color' => '#7c3aed'],
    ];
@endphp
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <meta name="color-scheme" content="light">
    <title>Resumo do dia</title>
</head>
<body style="margin:0; padding:0; width:100%; background-color:#eef0f5; -webkit-font-smoothing:antialiased;">

{{-- Prévia que aparece na lista de e-mails, ao lado do assunto. --}}
<div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent; height:0; width:0;">
    @if ($digest->overdue->isNotEmpty())
        {{ $digest->overdue->count() }} tarefa(s) passaram do prazo. Vamos limpar isso?
    @elseif ($digest->today->isNotEmpty())
        O que precisa da sua atenção hoje.
    @else
        Suas próximas entregas no Taskon.
    @endif
    &#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#eef0f5;">
<tr>
<td align="center" style="padding:28px 12px 40px;">

    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:600px; background-color:#ffffff; border-radius:18px; overflow:hidden; box-shadow:0 1px 3px rgba(15,23,42,0.08);">

        {{-- Cabeçalho: o gradiente é background-image com cor sólida de reserva
             para o Outlook, que ignora gradiente e ficaria com texto branco no
             branco. --}}
        <tr>
            <td style="background-color:#7c3aed; background-image:linear-gradient(120deg,#6d28d9 0%,#7c3aed 45%,#c026d3 100%); padding:28px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                        <td style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:17px; font-weight:700; color:#ffffff; letter-spacing:-0.2px;">
                            Taskon
                        </td>
                        <td align="right" style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:12px; color:rgba(255,255,255,0.75);">
                            {{ $now->locale('pt_BR')->translatedFormat('l, d \d\e F') }}
                        </td>
                    </tr>
                </table>

                <p style="margin:18px 0 0; font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:24px; line-height:1.25; font-weight:700; color:#ffffff;">
                    Bom dia, {{ \Illuminate\Support\Str::before($user->name, ' ') }}.
                </p>
                <p style="margin:6px 0 0; font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:14px; line-height:1.5; color:rgba(255,255,255,0.82);">
                    @if ($digest->overdue->isNotEmpty())
                        Tem coisa passando do prazo — comecemos por elas.
                    @elseif ($digest->today->isNotEmpty())
                        Seu dia tem entregas marcadas. Aqui estão.
                    @elseif ($digest->upcoming->isNotEmpty())
                        Nada vence hoje. Um bom dia para adiantar o que vem aí.
                    @else
                        Nenhuma pendência no radar. Aproveite.
                    @endif
                </p>
            </td>
        </tr>

        {{-- Placar --}}
        <tr>
            <td style="padding:22px 24px 6px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                        @foreach ($stats as $stat)
                            <td width="33.33%" align="center" style="padding:0 4px;">
                                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f8fafc; border:1px solid #e6e9ef; border-radius:12px;">
                                    <tr>
                                        <td align="center" style="padding:14px 8px;">
                                            <div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:26px; font-weight:700; line-height:1; color:{{ $stat['value'] > 0 ? $stat['color'] : '#94a3b8' }};">
                                                {{ $stat['value'] }}
                                            </div>
                                            <div style="margin-top:5px; font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.6px; color:#64748b;">
                                                {{ $stat['label'] }}
                                            </div>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        @endforeach
                    </tr>
                </table>
            </td>
        </tr>

        {{-- Seções de prazo --}}
        @foreach ($sections as $section)
            @php $tone = $tones[$section['tone']]; @endphp
            <tr>
                <td style="padding:22px 28px 0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                            <td style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.8px; color:{{ $tone['text'] }};">
                                {{ $section['title'] }}
                            </td>
                            <td align="right" style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:12px; font-weight:600; color:#94a3b8;">
                                {{ $section['total'] }}
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>

            @foreach ($section['cards'] as $card)
                <tr>
                    <td style="padding:10px 28px 0;">
                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:{{ $tone['chip'] }}; border-radius:10px;">
                            <tr>
                                {{-- Faixa colorida à esquerda: <td> com largura fixa
                                     aguenta o que border-left não aguenta no Outlook. --}}
                                <td width="4" style="width:4px; background-color:{{ $tone['bar'] }}; border-radius:10px 0 0 10px;">&nbsp;</td>
                                <td style="padding:12px 14px;">
                                    <a href="{{ route('cards.show', [$card->board_id, $card->id]) }}"
                                       style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:15px; font-weight:600; line-height:1.35; color:#0f172a; text-decoration:none;">
                                        {{ $card->title }}
                                    </a>
                                    <div style="margin-top:4px; font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:12px; line-height:1.5; color:#64748b;">
                                        <span style="color:{{ $tone['text'] }}; font-weight:600;">{{ $dueLabel($card) }}</span>
                                        &nbsp;·&nbsp; {{ $card->board->title }} &nbsp;›&nbsp; {{ $card->list->title }}
                                    </div>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            @endforeach

            @if ($section['total'] > $section['cards']->count())
                <tr>
                    <td style="padding:8px 28px 0; font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:12px; color:#94a3b8;">
                        e mais {{ $section['total'] - $section['cards']->count() }} nesta seção
                    </td>
                </tr>
            @endif
        @endforeach

        {{-- Concluídas: fecha o e-mail com o que já saiu do caminho. --}}
        @if ($completed->isNotEmpty())
            <tr>
                <td style="padding:24px 28px 0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f0fdf4; border:1px solid #dcfce7; border-radius:12px;">
                        <tr>
                            <td style="padding:14px 16px; font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                                <div style="font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.8px; color:#15803d;">
                                    Concluídas nas últimas 24 h · {{ $completed->count() }}
                                </div>
                                @foreach ($completed->take(5) as $card)
                                    <div style="margin-top:8px; font-size:14px; line-height:1.4; color:#166534;">
                                        <span style="color:#22c55e;">&#10003;</span>
                                        <span style="text-decoration:line-through; opacity:0.75;">{{ $card->title }}</span>
                                    </div>
                                @endforeach
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>
        @endif

        {{-- Chamada para ação --}}
        <tr>
            <td align="center" style="padding:28px 28px 4px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                        <td align="center" style="background-color:#7c3aed; border-radius:10px;">
                            <a href="{{ $dashboardUrl }}"
                               style="display:inline-block; padding:13px 30px; font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:15px; font-weight:600; color:#ffffff; text-decoration:none;">
                                Abrir o painel
                            </a>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>

        <tr>
            <td style="padding:26px 28px 30px;">
                <div style="height:1px; background-color:#e6e9ef; font-size:0; line-height:0;">&nbsp;</div>
                <p style="margin:16px 0 0; font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:12px; line-height:1.6; color:#94a3b8;">
                    Você recebe este resumo uma vez por dia porque tem cards atribuídos no Taskon.
                    <a href="{{ $settingsUrl }}" style="color:#7c3aed; text-decoration:underline;">Prefere não receber?</a>
                </p>
            </td>
        </tr>
    </table>

</td>
</tr>
</table>

</body>
</html>
