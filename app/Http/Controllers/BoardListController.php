<?php

namespace App\Http\Controllers;

use App\Models\Board;
use App\Models\BoardList;
use App\Support\ActivityLogger;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class BoardListController extends Controller
{
    public function store(Request $request, Board $board): RedirectResponse
    {
        $this->authorize('update', $board);

        $validated = $request->validate([
            'title' => ['required', 'string', 'max:120'],
        ]);

        $board->lists()->create([
            'title' => $validated['title'],
            'position' => ((float) $board->lists()->max('position')) + 1,
        ]);

        return back();
    }

    public function update(Request $request, BoardList $list): RedirectResponse
    {
        $this->authorize('update', $list->board);

        $validated = $request->validate([
            'title' => ['sometimes', 'required', 'string', 'max:120'],
            'card_limit' => ['nullable', 'integer', 'min:1', 'max:999'],
        ]);

        $list->update($validated);

        return back();
    }

    public function destroy(BoardList $list): RedirectResponse
    {
        $this->authorize('update', $list->board);

        $title = $list->title;
        $board = $list->board;

        $list->delete();

        ActivityLogger::log($board, 'list.deleted', "removeu a lista {$title}");

        return back();
    }

    /**
     * Reordena as colunas. O cliente manda a ordem final inteira: idempotente
     * e imune a divergências de índice depois de um drag.
     */
    public function reorder(Request $request, Board $board): RedirectResponse
    {
        $this->authorize('update', $board);

        $validated = $request->validate([
            'ordered_ids' => ['required', 'array'],
            'ordered_ids.*' => ['integer'],
        ]);

        $ids = $board->lists()->whereIn('id', $validated['ordered_ids'])->pluck('id')->all();

        DB::transaction(function () use ($validated, $ids, $board) {
            foreach ($validated['ordered_ids'] as $index => $id) {
                if (in_array((int) $id, $ids, true)) {
                    $board->lists()->whereKey($id)->update(['position' => $index + 1]);
                }
            }
        });

        return back();
    }
}
