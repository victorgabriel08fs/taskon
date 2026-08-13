<?php

namespace App\Http\Controllers;

use App\Models\Card;
use App\Models\Comment;
use App\Support\ActivityLogger;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

class CommentController extends Controller
{
    public function store(Request $request, Card $card): RedirectResponse
    {
        $this->authorize('update', $card->board);

        $validated = $request->validate([
            'body' => ['required', 'string', 'max:5000'],
        ]);

        $comment = new Comment($validated);
        $comment->card_id = $card->id;
        $comment->user_id = $request->user()->id;
        $comment->save();

        ActivityLogger::log($card->board, 'comment.created', "comentou em {$card->title}", $card);

        return back();
    }

    public function destroy(Request $request, Comment $comment): RedirectResponse
    {
        $card = $comment->card;

        $this->authorize('update', $card->board);
        abort_unless($comment->user_id === $request->user()->id, 403);

        $comment->delete();

        return back();
    }
}
