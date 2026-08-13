<?php

namespace App\Support;

use App\Models\Board;
use App\Models\Card;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Monta um quadro de boas-vindas para contas novas. O objetivo é que a
 * primeira tela do usuário já tenha conteúdo para arrastar.
 */
class DemoBoardBuilder
{
    /** @var array<int, array{0: string, 1: string}> */
    private const LABELS = [
        ['Design', 'violet'],
        ['Backend', 'blue'],
        ['Urgente', 'rose'],
        ['Melhoria', 'emerald'],
        ['Ideia', 'amber'],
    ];

    public static function for(User $user, string $title = 'Meu primeiro quadro'): Board
    {
        return DB::transaction(function () use ($user, $title): Board {
            $board = new Board([
                'title' => $title,
                'description' => 'Arraste os cards entre as colunas para ver a mágica acontecer.',
                'background' => 'aurora',
            ]);
            $board->owner_id = $user->id;
            $board->save();

            $board->members()->attach($user->id, ['role' => 'owner', 'last_opened_at' => now()]);

            $labels = [];
            foreach (self::LABELS as [$name, $color]) {
                $labels[$name] = $board->labels()->create(['name' => $name, 'color' => $color]);
            }

            $blueprint = [
                'Ideias' => [
                    ['Modo foco com atalho de teclado', ['Ideia'], null],
                    ['Exportar quadro em PDF', ['Ideia', 'Melhoria'], null],
                ],
                'A fazer' => [
                    ['Revisar textos da página inicial', ['Design'], now()->addDays(3)],
                    ['Criar etiquetas do time', ['Melhoria'], null],
                    ['Configurar backup do banco', ['Backend', 'Urgente'], now()->addDay()],
                ],
                'Em andamento' => [
                    ['Arrastar e soltar entre colunas', ['Design', 'Backend'], now()->addDays(2)],
                ],
                'Concluído' => [
                    ['Instalar o Taskon localmente', ['Backend'], null],
                ],
            ];

            $listPosition = 0;

            foreach ($blueprint as $listTitle => $cards) {
                $list = $board->lists()->create([
                    'title' => $listTitle,
                    'position' => ++$listPosition,
                ]);

                foreach ($cards as $index => [$cardTitle, $cardLabels, $dueAt]) {
                    $card = new Card([
                        'title' => $cardTitle,
                        'position' => $index + 1,
                        'due_at' => $dueAt,
                        'completed_at' => $listTitle === 'Concluído' ? now() : null,
                    ]);
                    $card->board_id = $board->id;
                    $card->board_list_id = $list->id;
                    $card->created_by = $user->id;
                    $card->save();

                    $card->labels()->attach(collect($cardLabels)->map(fn ($n) => $labels[$n]->id)->all());
                    $card->members()->attach($user->id);
                }
            }

            $checklistCard = $board->cards()->where('title', 'Arrastar e soltar entre colunas')->first();

            if ($checklistCard) {
                $checklist = $checklistCard->checklists()->create(['title' => 'Passo a passo', 'position' => 1]);

                foreach ([
                    ['Arraste este card para outra coluna', true],
                    ['Reordene as colunas pelo cabeçalho', false],
                    ['Abra o card e escreva uma descrição', false],
                ] as $position => [$content, $done]) {
                    $checklist->items()->create([
                        'content' => $content,
                        'is_done' => $done,
                        'position' => $position + 1,
                    ]);
                }

                $checklistCard->comments()->forceCreate([
                    'user_id' => $user->id,
                    'body' => 'Bem-vindo ao Taskon! Este é um comentário de exemplo — pode apagar.',
                ]);
            }

            ActivityLogger::log($board, 'board.created', "criou o quadro {$board->title}");

            return $board;
        });
    }
}
