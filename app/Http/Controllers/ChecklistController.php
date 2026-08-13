<?php

namespace App\Http\Controllers;

use App\Models\Card;
use App\Models\Checklist;
use App\Models\ChecklistItem;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

class ChecklistController extends Controller
{
    public function store(Request $request, Card $card): RedirectResponse
    {
        $this->authorize('update', $card->board);

        $validated = $request->validate([
            'title' => ['required', 'string', 'max:120'],
        ]);

        $card->checklists()->create([
            'title' => $validated['title'],
            'position' => ((float) $card->checklists()->max('position')) + 1,
        ]);

        return back();
    }

    public function destroy(Checklist $checklist): RedirectResponse
    {
        $this->authorize('update', $checklist->card->board);

        $checklist->delete();

        return back();
    }

    public function storeItem(Request $request, Checklist $checklist): RedirectResponse
    {
        $this->authorize('update', $checklist->card->board);

        $validated = $request->validate([
            'content' => ['required', 'string', 'max:500'],
        ]);

        $checklist->items()->create([
            'content' => $validated['content'],
            'position' => ((float) $checklist->items()->max('position')) + 1,
        ]);

        return back();
    }

    public function updateItem(Request $request, ChecklistItem $item): RedirectResponse
    {
        $this->authorize('update', $item->checklist->card->board);

        $validated = $request->validate([
            'content' => ['sometimes', 'required', 'string', 'max:500'],
            'is_done' => ['sometimes', 'boolean'],
        ]);

        $item->update($validated);

        return back();
    }

    public function destroyItem(ChecklistItem $item): RedirectResponse
    {
        $this->authorize('update', $item->checklist->card->board);

        $item->delete();

        return back();
    }
}
