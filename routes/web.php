<?php

use App\Http\Controllers\BoardController;
use App\Http\Controllers\BoardListController;
use App\Http\Controllers\BoardMemberController;
use App\Http\Controllers\CardController;
use App\Http\Controllers\ChecklistController;
use App\Http\Controllers\CommentController;
use App\Http\Controllers\LabelController;
use Illuminate\Support\Facades\Route;
use Inertia\Inertia;

Route::get('/', fn () => Inertia::render('welcome'))->name('home');

Route::middleware('auth')->group(function () {
    Route::get('/dashboard', [BoardController::class, 'index'])->name('dashboard');

    /*
    |--------------------------------------------------------------------------
    | Quadros
    |--------------------------------------------------------------------------
    */
    Route::post('/boards', [BoardController::class, 'store'])->name('boards.store');
    Route::get('/boards/{board}', [BoardController::class, 'show'])->name('boards.show');
    Route::patch('/boards/{board}', [BoardController::class, 'update'])->name('boards.update');
    Route::delete('/boards/{board}', [BoardController::class, 'destroy'])->name('boards.destroy');
    Route::post('/boards/{board}/favorite', [BoardController::class, 'toggleFavorite'])->name('boards.favorite');

    // Deep link do card: renderiza o mesmo quadro com o modal aberto.
    Route::get('/boards/{board}/cards/{card}', [BoardController::class, 'show'])->name('cards.show');

    /*
    |--------------------------------------------------------------------------
    | Listas (colunas)
    |--------------------------------------------------------------------------
    */
    Route::post('/boards/{board}/lists', [BoardListController::class, 'store'])->name('lists.store');
    Route::patch('/boards/{board}/lists/reorder', [BoardListController::class, 'reorder'])->name('lists.reorder');
    Route::patch('/lists/{list}', [BoardListController::class, 'update'])->name('lists.update');
    Route::delete('/lists/{list}', [BoardListController::class, 'destroy'])->name('lists.destroy');

    /*
    |--------------------------------------------------------------------------
    | Cards
    |--------------------------------------------------------------------------
    */
    Route::post('/lists/{list}/cards', [CardController::class, 'store'])->name('cards.store');
    Route::patch('/cards/{card}', [CardController::class, 'update'])->name('cards.update');
    Route::delete('/cards/{card}', [CardController::class, 'destroy'])->name('cards.destroy');
    Route::patch('/cards/{card}/move', [CardController::class, 'move'])->name('cards.move');
    Route::post('/cards/{card}/labels/{labelId}', [CardController::class, 'toggleLabel'])->name('cards.labels.toggle');
    Route::post('/cards/{card}/members/{userId}', [CardController::class, 'toggleMember'])->name('cards.members.toggle');

    /*
    |--------------------------------------------------------------------------
    | Comentários, checklists e etiquetas
    |--------------------------------------------------------------------------
    */
    Route::post('/cards/{card}/comments', [CommentController::class, 'store'])->name('comments.store');
    Route::delete('/comments/{comment}', [CommentController::class, 'destroy'])->name('comments.destroy');

    Route::post('/cards/{card}/checklists', [ChecklistController::class, 'store'])->name('checklists.store');
    Route::delete('/checklists/{checklist}', [ChecklistController::class, 'destroy'])->name('checklists.destroy');
    Route::post('/checklists/{checklist}/items', [ChecklistController::class, 'storeItem'])->name('checklists.items.store');
    Route::patch('/checklist-items/{item}', [ChecklistController::class, 'updateItem'])->name('checklists.items.update');
    Route::delete('/checklist-items/{item}', [ChecklistController::class, 'destroyItem'])->name('checklists.items.destroy');

    Route::post('/boards/{board}/labels', [LabelController::class, 'store'])->name('labels.store');
    Route::patch('/labels/{label}', [LabelController::class, 'update'])->name('labels.update');
    Route::delete('/labels/{label}', [LabelController::class, 'destroy'])->name('labels.destroy');

    /*
    |--------------------------------------------------------------------------
    | Membros do quadro
    |--------------------------------------------------------------------------
    */
    Route::post('/boards/{board}/members', [BoardMemberController::class, 'store'])->name('boards.members.store');
    Route::delete('/boards/{board}/members/{user}', [BoardMemberController::class, 'destroy'])->name('boards.members.destroy');
});

require __DIR__.'/auth.php';
require __DIR__.'/settings.php';
