<?php

namespace App\Http\Controllers;

use App\Models\Board;
use App\Models\User;
use App\Support\ActivityLogger;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;

class BoardMemberController extends Controller
{
    public function store(Request $request, Board $board): RedirectResponse
    {
        $this->authorize('manage', $board);

        $validated = $request->validate([
            'email' => ['required', 'email'],
            'role' => ['required', Rule::in(['admin', 'member'])],
        ]);

        $user = User::where('email', $validated['email'])->first();

        if (! $user) {
            throw ValidationException::withMessages([
                'email' => 'Nenhuma conta com esse e-mail. Peça para a pessoa se cadastrar primeiro.',
            ]);
        }

        if ($board->members()->whereKey($user->id)->exists()) {
            throw ValidationException::withMessages([
                'email' => 'Essa pessoa já participa do quadro.',
            ]);
        }

        $board->members()->attach($user->id, ['role' => $validated['role']]);

        ActivityLogger::log($board, 'member.added', "adicionou {$user->name} ao quadro");

        Inertia::flash('toast', ['type' => 'success', 'message' => "{$user->name} entrou no quadro."]);

        return back();
    }

    public function destroy(Board $board, User $user): RedirectResponse
    {
        $this->authorize('manage', $board);

        if ($board->owner_id === $user->id) {
            throw ValidationException::withMessages([
                'email' => 'O dono do quadro não pode ser removido.',
            ]);
        }

        $board->members()->detach($user->id);

        ActivityLogger::log($board, 'member.removed', "removeu {$user->name} do quadro");

        return back();
    }
}
