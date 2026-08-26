<?php

namespace App\Http\Controllers;

use App\Http\Resources\ActivityResource;
use App\Http\Resources\ArchivedCardResource;
use App\Http\Resources\BoardResource;
use App\Http\Resources\BoardSummaryResource;
use App\Http\Resources\CardDetailResource;
use App\Http\Resources\CardExportResource;
use App\Models\Board;
use App\Models\Card;
use App\Support\ActivityLogger;
use App\Support\DoneCardArchiver;
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

                // `counted()` e não `whereNull(archived_at)`: a barra de
                // progresso do card do quadro é done/total, e sem isso arquivar
                // os concluídos a jogaria de 100% para 0%. Ver Card::scopeCounted.
                'cards as cards_count' => fn ($q) => $q->counted(),
                'cards as cards_done_count' => fn ($q) => $q->whereNotNull('cards.completed_at'),
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

        // Só o número: é ele que decide se o menu do quadro mostra a gaveta de
        // arquivados, e a lista em si só é lida quando alguém a abre.
        $board->loadCount([
            'cards as archived_cards_count' => fn ($q) => $q->whereNotNull('cards.archived_at'),
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

            // Prazos e horário da varredura vêm do servidor porque é ele quem
            // os valida e os executa: a tela não pode oferecer um prazo que o
            // backend recusa, nem prometer um horário que o agendador não tem.
            'autoArchive' => config('taskon.auto_archive'),
            'activity' => Inertia::defer(fn () => ActivityResource::collection(
                $board->activities()->with('user')->limit(config('taskon.limits.activities_per_board'))->get()
            )),

            // `optional` e não `defer`: descrição, checklist e comentário de
            // TODOS os cards só são lidos quando alguém abre a exportação.
            // Adiada, a consulta rodaria em toda visita ao quadro.
            'exportDetails' => Inertia::optional(fn () => CardExportResource::collection(
                $board->cards()
                    ->whereNull('cards.archived_at')
                    ->with([
                        'checklists.items',
                        // A relação já vem `latest()`; no texto exportado a
                        // conversa faz sentido do começo para o fim.
                        'comments' => fn ($q) => $q->reorder('created_at')->with('author'),
                    ])
                    // Só as colunas que faltam: o resto do card já está em `board`.
                    ->get(['id', 'description'])
            )),

            // Mesma ideia do exportDetails: `optional`, porque a gaveta de
            // arquivados é rara e não pode custar uma consulta em toda visita
            // ao quadro. Diferente dele, é pedida a cada abertura — restaurar
            // um card muda a lista, e uma cópia velha ofereceria "restaurar"
            // num card que já voltou.
            'archivedCards' => Inertia::optional(fn () => ArchivedCardResource::collection(
                $board->cards()
                    ->whereNotNull('cards.archived_at')
                    ->with('list:id,title')
                    ->orderByDesc('cards.archived_at')
                    ->limit(config('taskon.limits.archived_per_board'))
                    ->get()
            )),
        ]);
    }

    /**
     * Roda a varredura deste quadro agora, sem esperar a madrugada.
     *
     * Existe porque o recurso é invisível até a primeira vez que acontece:
     * quem acabou de escolher "7 dias" não tem como saber o que vai sumir nem
     * conferir se acertou. O botão transforma uma promessa em resultado — e usa
     * exatamente o mesmo filtro do agendador, senão a prévia mentiria.
     */
    public function archiveDone(Board $board): RedirectResponse
    {
        $this->authorize('manage', $board);

        if ($board->auto_archive_done_after_days === null) {
            Inertia::flash('toast', [
                'type' => 'info',
                'message' => 'Escolha um prazo antes de arquivar os concluídos.',
            ]);

            return back();
        }

        $archived = DoneCardArchiver::sweep($board);

        Inertia::flash('toast', [
            'type' => $archived > 0 ? 'success' : 'info',
            'message' => $archived === 0
                ? 'Nenhum concluído passou do prazo ainda.'
                : DoneCardArchiver::plural($archived, 'card arquivado', 'cards arquivados').'.',
        ]);

        return back();
    }

    public function update(Request $request, Board $board): RedirectResponse
    {
        $this->authorize('manage', $board);

        $validated = $request->validate([
            'title' => ['sometimes', 'required', 'string', 'max:120'],
            'description' => ['nullable', 'string', 'max:2000'],
            'background' => ['sometimes', 'required', 'string', Rule::in(config('taskon.backgrounds'))],

            // `nullable` sem `required`: mandar null é o jeito de desligar.
            'auto_archive_done_after_days' => [
                'sometimes', 'nullable', 'integer', Rule::in(config('taskon.auto_archive.options')),
            ],
        ]);

        $novoPrazo = array_key_exists('auto_archive_done_after_days', $validated)
            ? ($validated['auto_archive_done_after_days'] === null
                ? null
                : (int) $validated['auto_archive_done_after_days'])
            : $board->auto_archive_done_after_days;

        // Cards sumindo sozinhos é o tipo de coisa que assusta quem não estava
        // na sala quando foi ligada. A troca de prazo fica no histórico do
        // quadro para a resposta estar lá quando alguém perguntar.
        $mudou = $novoPrazo !== $board->auto_archive_done_after_days;

        $board->update($validated);

        if ($mudou) {
            ActivityLogger::log(
                $board,
                'board.auto_archive',
                $novoPrazo === null
                    ? 'desligou o arquivamento automático dos concluídos'
                    : 'passou a arquivar os concluídos depois de '
                        .DoneCardArchiver::plural($novoPrazo, 'dia', 'dias'),
                properties: ['after_days' => $novoPrazo],
            );
        }

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
