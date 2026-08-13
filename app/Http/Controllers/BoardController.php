<?php

namespace App\Http\Controllers;

use App\Http\Resources\ActivityResource;
use App\Http\Resources\BoardResource;
use App\Http\Resources\BoardSummaryResource;
use App\Http\Resources\CardDetailResource;
use App\Models\Board;
use App\Models\Card;
use App\Support\ActivityLogger;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;

class BoardController extends Controller
{
    /**
     * A lista de quadros do usuário, favoritos primeiro. Os números agregados
     * (e os gráficos) ficam no DashboardController.
     */
    public function index(Request $request): Response
    {
        $boards = $request->user()->boards()
            ->whereNull('boards.archived_at')
            ->withCount([
                'lists as lists_count' => fn ($q) => $q->whereNull('board_lists.archived_at'),
                'cards as cards_count' => fn ($q) => $q->whereNull('cards.archived_at'),
                'cards as cards_done_count' => fn ($q) => $q->whereNull('cards.archived_at')->whereNotNull('cards.completed_at'),
            ])
            ->with('members')
            ->orderByPivot('is_favorite', 'desc')
            ->orderByPivot('last_opened_at', 'desc')
            ->orderBy('boards.created_at', 'desc')
            ->get();

        return Inertia::render('boards/index', [
            'boards' => BoardSummaryResource::collection($boards),
            'backgrounds' => config('taskon.backgrounds'),
        ]);
    }

    public function store(Request $request): RedirectResponse
    {
        $validated = $request->validate([
            'title' => ['required', 'string', 'max:120'],
            'background' => ['required', 'string', Rule::in(config('taskon.backgrounds'))],
        ]);

        $board = DB::transaction(function () use ($request, $validated): Board {
            $board = new Board($validated);
            $board->owner_id = $request->user()->id;
            $board->save();

            $board->members()->attach($request->user()->id, [
                'role' => 'owner',
                'last_opened_at' => now(),
            ]);

            foreach (['Verde' => 'emerald', 'Urgente' => 'rose', 'Ideia' => 'violet', 'Bloqueado' => 'amber'] as $name => $color) {
                $board->labels()->create(['name' => $name, 'color' => $color]);
            }

            foreach (['A fazer', 'Em andamento', 'Concluído'] as $index => $title) {
                $board->lists()->create([
                    'title' => $title,
                    'position' => $index + 1,
                    // Arrastar para cá marca o card como concluído. Sem isso, a
                    // coluna seria só um nome e o painel contaria os cards de
                    // lá como abertos.
                    'is_done' => $title === 'Concluído',
                ]);
            }

            ActivityLogger::log($board, 'board.created', "criou o quadro {$board->title}");

            return $board;
        });

        Inertia::flash('toast', ['type' => 'success', 'message' => 'Quadro criado.']);

        return redirect()->route('boards.show', $board);
    }

    /**
     * O quadro em si. Quando a URL aponta para um card, ele vem junto como
     * `activeCard` — assim o modal é deep-linkable e recarregável.
     */
    public function show(Request $request, Board $board, ?Card $card = null): Response
    {
        $this->authorize('view', $board);

        if ($card && $card->board_id !== $board->id) {
            abort(404);
        }

        $board->load([
            'members',
            'labels',
            'lists' => fn ($q) => $q->whereNull('archived_at')->with([
                'cards' => fn ($q) => $q->whereNull('archived_at')
                    ->orderBy('position')
                    ->orderBy('id')
                    ->with(['labels:id', 'members:id'])
                    ->withCount([
                        'comments',
                        'checklistItems',
                        'checklistItems as checklist_items_done_count' => fn ($q) => $q->where('checklist_items.is_done', true),
                    ]),
            ]),
        ]);

        $request->user()->boards()->updateExistingPivot($board->id, ['last_opened_at' => now()]);

        return Inertia::render('boards/show', [
            'board' => new BoardResource($board),
            'activeCard' => $card
                ? new CardDetailResource($card->load([
                    'list',
                    'labels:id',
                    'members:id',
                    'comments.author',
                    'checklists.items',
                    'activities' => fn ($q) => $q->with('user')->limit(config('taskon.limits.activities_per_card')),
                ]))
                : null,
            'backgrounds' => config('taskon.backgrounds'),
            'colors' => config('taskon.colors'),
            'activity' => Inertia::defer(fn () => ActivityResource::collection(
                $board->activities()->with('user')->limit(config('taskon.limits.activities_per_board'))->get()
            )),
        ]);
    }

    public function update(Request $request, Board $board): RedirectResponse
    {
        $this->authorize('manage', $board);

        $validated = $request->validate([
            'title' => ['sometimes', 'required', 'string', 'max:120'],
            'description' => ['nullable', 'string', 'max:2000'],
            'background' => ['sometimes', 'required', 'string', Rule::in(config('taskon.backgrounds'))],
        ]);

        $board->update($validated);

        return back();
    }

    public function destroy(Board $board): RedirectResponse
    {
        $this->authorize('delete', $board);

        $board->delete();

        Inertia::flash('toast', ['type' => 'success', 'message' => 'Quadro excluído.']);

        return redirect()->route('boards.index');
    }

    public function toggleFavorite(Request $request, Board $board): RedirectResponse
    {
        $this->authorize('view', $board);

        $current = (bool) $request->user()->boards()
            ->whereKey($board->id)
            ->value('board_user.is_favorite');

        $request->user()->boards()->updateExistingPivot($board->id, ['is_favorite' => ! $current]);

        return back();
    }
}
