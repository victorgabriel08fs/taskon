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
     * O recorte de PROGRESSO: o que ainda está no quadro, mais o que saiu de lá
     * já concluído.
     *
     * Arquivar um concluído não pode apagar a conquista. Sem esta linha, ligar
     * o arquivamento automático faria o painel afundar sozinho — o card sairia
     * do total E do concluído, e a barra do quadro voltaria de 100% para 0%
     * justamente por o trabalho ter terminado.
     *
     * Já o card arquivado SEM concluir foi abandonado de propósito: ele sai dos
     * dois lados da conta, e a proporção sobe. É o efeito correto — tirar lixo
     * da mesa não é regredir.
     *
     * @param  Builder<Card>  $query
     */
    public function scopeCounted(Builder $query): void
    {
        $query->where(fn (Builder $q) => $q
            ->whereNull('cards.archived_at')
            ->orWhereNotNull('cards.completed_at'));
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
     * `$history` troca o recorte de "o que ainda está no quadro" por `counted()`:
     * é o que conta o que foi FEITO (quantas concluí na semana), e não o que
     * FALTA (o e-mail, o anel de prazos). Arquivado nunca entra em "falta".
     *
     * @param  Builder<Card>  $query
     */
    public function scopeAssignedTo(Builder $query, User $user, bool $history = false): void
    {
        $query
            ->when(
                $history,
                fn (Builder $q) => $q->counted(),
                fn (Builder $q) => $q->whereNull('cards.archived_at'),
            )
            ->whereHas('members', fn (Builder $q) => $q->whereKey($user->getKey()))
            ->whereHas('board', fn (Builder $q) => $q
                ->whereNull('boards.archived_at')
                ->whereHas('members', fn (Builder $q) => $q->whereKey($user->getKey())));
    }
}
