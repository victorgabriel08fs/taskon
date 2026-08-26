<?php

namespace App\Http\Resources;

use App\Models\Card;
use App\Models\Checklist;
use App\Models\ChecklistItem;
use App\Models\Comment;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * O que o card tem além do que a coluna do Kanban já mostra: descrição, itens
 * de checklist e comentários.
 *
 * Título, prazo, etiquetas e responsáveis **não** se repetem aqui. A tela de
 * exportação junta este detalhe ao card que já veio dentro de `board`, e
 * duplicar tudo dobraria um payload que já carrega o quadro inteiro.
 *
 * @mixin Card
 */
class CardExportResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'description' => $this->description,
            'checklists' => $this->whenLoaded('checklists', fn () => $this->checklists
                ->map(fn (Checklist $checklist) => [
                    'title' => $checklist->title,
                    'items' => $checklist->items->map(fn (ChecklistItem $item) => [
                        'content' => $item->content,
                        'is_done' => (bool) $item->is_done,
                    ])->all(),
                ])->all(), []),
            'comments' => $this->whenLoaded('comments', fn () => $this->comments
                ->map(fn (Comment $comment) => [
                    'author' => $comment->author?->name,
                    'body' => $comment->body,
                    'created_at' => $comment->created_at?->toIso8601String(),
                ])->all(), []),
        ];
    }
}
