<?php

namespace App\Http\Controllers;

use App\Models\BoardList;
use App\Models\Card;
use App\Support\ActivityLogger;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Inertia\Inertia;

class CardController extends Controller
{
    public function store(Request $request, BoardList $list): RedirectResponse
    {
        $this->authorize('update', $list->board);

        $validated = $request->validate([
            'title' => ['required', 'string', 'max:500'],
        ]);

        $card = DB::transaction(function () use ($request, $list, $validated): Card {
            $card = new Card([
                'title' => $validated['title'],
                'position' => ((float) $list->cards()->max('position')) + 1,
            ]);

            $card->board_id = $list->board_id;
            $card->board_list_id = $list->id;
            $card->created_by = $request->user()->id;
            $card->save();

            // Quem escreve a tarefa já entra como responsável. Sem isso o card
            // nasce sem dono: fica de fora do filtro "só os meus", do painel e
            // do resumo diário de quem acabou de criá-lo — e tirar o próprio
            // nome depois custa um clique, enquanto lembrar de se atribuir em
            // cada card custa a atenção que o composer inline economiza.
            $card->members()->attach($request->user()->id);

            return $card;
        });

        ActivityLogger::log($list->board, 'card.created', "adicionou {$card->title} em {$list->title}", $card);

        return back();
    }

    public function update(Request $request, Card $card): RedirectResponse
    {
        $this->authorize('update', $card->board);

        $validated = $request->validate([
            'title' => ['sometimes', 'required', 'string', 'max:500'],
            'description' => ['nullable', 'string', 'max:20000'],
            'cover_color' => ['nullable', 'string', Rule::in(config('taskon.colors'))],
            'due_at' => ['nullable', 'date'],
            'is_completed' => ['sometimes', 'boolean'],
        ]);

        if (array_key_exists('is_completed', $validated)) {
            $card->completed_at = $validated['is_completed'] ? now() : null;

            ActivityLogger::log(
                $card->board,
                $validated['is_completed'] ? 'card.completed' : 'card.reopened',
                ($validated['is_completed'] ? 'concluiu ' : 'reabriu ').$card->title,
                $card,
            );
        }

        $card->fill(collect($validated)->except('is_completed')->all())->save();

        return back();
    }

    public function destroy(Card $card): RedirectResponse
    {
        $this->authorize('update', $card->board);

        $board = $card->board;
        $title = $card->title;

        $card->delete();

        ActivityLogger::log($board, 'card.deleted', "excluiu {$title}");

        Inertia::flash('toast', ['type' => 'success', 'message' => "\"{$title}\" foi excluído."]);

        // Redirect explícito, não back(): a URL anterior pode ser a do próprio
        // card (/boards/1/cards/42), que agora daria 404.
        return redirect()->route('boards.show', $board);
    }

    /**
     * Tira o card do quadro sem apagá-lo.
     *
     * É a mesma porta que a varredura automática usa (App\Support\DoneCardArchiver);
     * o que muda é quem puxa o gatilho e o fato de que aqui não é preciso estar
     * concluído — arquivar na mão é como se guarda o que foi abandonado.
     */
    public function archive(Card $card): RedirectResponse
    {
        $this->authorize('update', $card->board);

        if ($card->archived_at === null) {
            // forceFill: archived_at não é fillable, e não deveria ser — nenhum
            // formulário do app tem por que mandar essa coluna.
            $card->forceFill(['archived_at' => now()])->save();

            ActivityLogger::log($card->board, 'card.archived', "arquivou {$card->title}", $card);
        }

        // O caminho de volta vai junto com o aviso: o card acabou de sumir da
        // tela, e "foi arquivado" sozinho não diz para onde ele foi.
        Inertia::flash('toast', [
            'type' => 'success',
            'message' => "\"{$card->title}\" foi para Arquivados, no menu do quadro.",
        ]);

        // Redirect explícito, não back(): a URL anterior pode ser a do próprio
        // card, e voltar para lá reabriria o modal de um card que não está mais
        // no quadro.
        return redirect()->route('boards.show', $card->board_id);
    }

    /**
     * Devolve o card ao quadro — reaberto e no fim da fila.
     *
     * Reabrir não é capricho: um card que voltasse ainda concluído passaria de
     * novo pelo filtro da varredura e sumiria na madrugada seguinte, e a pessoa
     * ficaria restaurando o mesmo card todo dia. Quem resgata um concluído
     * quer justamente mexer nele outra vez.
     *
     * Pela mesma razão ele não volta para a coluna de conclusão: um card aberto
     * no meio dos prontos é invisível. Volta para a primeira coluna comum, e o
     * toast diz para onde foi — o card não pode reaparecer num lugar que
     * ninguém consegue adivinhar.
     */
    public function restore(Card $card): RedirectResponse
    {
        $this->authorize('update', $card->board);

        abort_if($card->archived_at === null, 404);

        $list = $card->list;

        if ($list === null || $list->is_done) {
            $list = $card->board->lists()
                ->whereNull('archived_at')
                ->where('is_done', false)
                ->first() ?? $list;
        }

        // Quadro sem uma única coluna viva: não há para onde devolver.
        abort_if($list === null, 404);

        $card->forceFill([
            'archived_at' => null,
            'completed_at' => null,
            'board_list_id' => $list->id,
            'position' => ((float) $list->cards()->whereNull('archived_at')->max('position')) + 1,
        ])->save();

        ActivityLogger::log($card->board, 'card.restored', "restaurou {$card->title} em {$list->title}", $card);

        Inertia::flash('toast', [
            'type' => 'success',
            'message' => "\"{$card->title}\" voltou para {$list->title}.",
        ]);

        return back();
    }

    /**
     * Move o card para uma lista/posição. O cliente envia a ordem completa da
     * lista de destino — o servidor só materializa o que a UI já mostrou.
     */
    public function move(Request $request, Card $card): RedirectResponse
    {
        $this->authorize('update', $card->board);

        $validated = $request->validate([
            'board_list_id' => [
                'required',
                Rule::exists('board_lists', 'id')->where('board_id', $card->board_id),
            ],
            'ordered_ids' => ['required', 'array'],
            'ordered_ids.*' => ['integer'],
        ]);

        $fromList = $card->list;
        $toList = BoardList::findOrFail($validated['board_list_id']);
        $crossed = $this->completionCrossing($fromList, $toList);

        DB::transaction(function () use ($card, $validated, $toList, $crossed) {
            $card->board_list_id = $toList->id;

            if ($crossed === 'completed' && $card->completed_at === null) {
                $card->completed_at = now();
            } elseif ($crossed === 'reopened' && $card->completed_at !== null) {
                $card->completed_at = null;
            }

            $card->save();

            $allowed = Card::query()
                ->where('board_list_id', $validated['board_list_id'])
                ->whereIn('id', $validated['ordered_ids'])
                ->pluck('id')
                ->all();

            foreach ($validated['ordered_ids'] as $index => $id) {
                if (in_array((int) $id, $allowed, true)) {
                    Card::query()->whereKey($id)->update(['position' => $index + 1]);
                }
            }
        });

        if ($fromList && $fromList->id !== $toList->id) {
            ActivityLogger::log(
                $card->board,
                'card.moved',
                "moveu {$card->title} de {$fromList->title} para {$toList->title}",
                $card,
            );

            if ($crossed !== null) {
                ActivityLogger::log(
                    $card->board,
                    $crossed === 'completed' ? 'card.completed' : 'card.reopened',
                    ($crossed === 'completed' ? 'concluiu ' : 'reabriu ').$card->title,
                    $card,
                );
            }
        }

        return back();
    }

    /**
     * O card cruzou a fronteira da coluna de conclusão?
     *
     * Só o cruzamento mexe em completed_at. Mover entre duas colunas comuns não
     * pode desmarcar um card que a pessoa concluiu no próprio card — a
     * caixinha do modal é uma decisão manual, e arrastar não deve desfazê-la.
     */
    private function completionCrossing(?BoardList $from, BoardList $to): ?string
    {
        if ($from === null || $from->id === $to->id || $from->is_done === $to->is_done) {
            return null;
        }

        return $to->is_done ? 'completed' : 'reopened';
    }

    public function toggleLabel(Card $card, int $labelId): RedirectResponse
    {
        $this->authorize('update', $card->board);

        abort_unless($card->board->labels()->whereKey($labelId)->exists(), 404);

        $card->labels()->toggle($labelId);

        return back();
    }

    public function toggleMember(Card $card, int $userId): RedirectResponse
    {
        $this->authorize('update', $card->board);

        abort_unless($card->board->members()->whereKey($userId)->exists(), 404);

        $card->members()->toggle($userId);

        return back();
    }
}
