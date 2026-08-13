<?php

namespace App\Models;

use Database\Factories\CardFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasManyThrough;

#[Fillable(['title', 'description', 'position', 'cover_color', 'due_at', 'completed_at'])]
class Card extends Model
{
    /** @use HasFactory<CardFactory> */
    use HasFactory;

    protected function casts(): array
    {
        return [
            'position' => 'float',
            'due_at' => 'datetime',
            'completed_at' => 'datetime',
            'archived_at' => 'datetime',
        ];
    }

    /** @return BelongsTo<Board, $this> */
    public function board(): BelongsTo
    {
        return $this->belongsTo(Board::class);
    }

    /** @return BelongsTo<BoardList, $this> */
    public function list(): BelongsTo
    {
        return $this->belongsTo(BoardList::class, 'board_list_id');
    }

    /** @return BelongsTo<User, $this> */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /** @return BelongsToMany<User, $this> */
    public function members(): BelongsToMany
    {
        return $this->belongsToMany(User::class);
    }

    /** @return BelongsToMany<Label, $this> */
    public function labels(): BelongsToMany
    {
        return $this->belongsToMany(Label::class);
    }

    /** @return HasMany<Comment, $this> */
    public function comments(): HasMany
    {
        return $this->hasMany(Comment::class)->latest();
    }

    /** @return HasMany<Checklist, $this> */
    public function checklists(): HasMany
    {
        return $this->hasMany(Checklist::class)->orderBy('position');
    }

    /**
     * Atalho para contar itens de checklist sem carregar as checklists.
     *
     * @return HasManyThrough<ChecklistItem, Checklist, $this>
     */
    public function checklistItems(): HasManyThrough
    {
        return $this->hasManyThrough(ChecklistItem::class, Checklist::class);
    }

    /** @return HasMany<Activity, $this> */
    public function activities(): HasMany
    {
        return $this->hasMany(Activity::class)->latest();
    }

    /**
     * Cards vivos atribuídos ao usuário, em quadros de que ele ainda participa.
     *
     * O segundo whereHas não é redundante: sair de um quadro não apaga a
     * atribuição dos cards, e sem esse filtro a pessoa continuaria vendo (e
     * recebendo por e-mail) tarefas de um quadro que já não pode nem abrir.
     *
     * É a definição de "minhas tarefas" que o resumo diário e o painel
     * compartilham — se as duas divergirem, o e-mail vira mentira sobre a tela.
     *
     * @param  Builder<Card>  $query
     */
    public function scopeAssignedTo(Builder $query, User $user): void
    {
        $query
            ->whereNull('cards.archived_at')
            ->whereHas('members', fn (Builder $q) => $q->whereKey($user->getKey()))
            ->whereHas('board', fn (Builder $q) => $q
                ->whereNull('boards.archived_at')
                ->whereHas('members', fn (Builder $q) => $q->whereKey($user->getKey())));
    }
}
