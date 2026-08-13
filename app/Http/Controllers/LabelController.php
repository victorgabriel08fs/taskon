<?php

namespace App\Http\Controllers;

use App\Models\Board;
use App\Models\Label;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class LabelController extends Controller
{
    public function store(Request $request, Board $board): RedirectResponse
    {
        $this->authorize('manage', $board);

        $validated = $request->validate([
            'name' => ['nullable', 'string', 'max:60'],
            'color' => ['required', 'string', Rule::in(config('taskon.colors'))],
        ]);

        $board->labels()->create($validated);

        return back();
    }

    public function update(Request $request, Label $label): RedirectResponse
    {
        $this->authorize('manage', $label->board);

        $validated = $request->validate([
            'name' => ['nullable', 'string', 'max:60'],
            'color' => ['sometimes', 'required', 'string', Rule::in(config('taskon.colors'))],
        ]);

        $label->update($validated);

        return back();
    }

    public function destroy(Label $label): RedirectResponse
    {
        $this->authorize('manage', $label->board);

        $label->delete();

        return back();
    }
}
