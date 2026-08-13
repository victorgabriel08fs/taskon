<?php

namespace App\Models;

use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Appends;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Support\Str;

#[Fillable(['name', 'email', 'password', 'avatar_color', 'title'])]
#[Hidden(['password', 'remember_token'])]
#[Appends(['initials'])]
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasFactory, Notifiable;

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
        ];
    }

    /**
     * Iniciais usadas no avatar quando não há imagem.
     *
     * @return Attribute<string, never>
     */
    protected function initials(): Attribute
    {
        return Attribute::get(function (): string {
            $words = preg_split('/\s+/', trim((string) $this->name)) ?: [];
            $words = array_values(array_filter($words));

            return match (count($words)) {
                0 => '?',
                1 => Str::upper(Str::substr($words[0], 0, 2)),
                default => Str::upper(Str::substr($words[0], 0, 1).Str::substr(end($words), 0, 1)),
            };
        });
    }

    /** @return HasMany<Board, $this> */
    public function ownedBoards(): HasMany
    {
        return $this->hasMany(Board::class, 'owner_id');
    }

    /** @return BelongsToMany<Board, $this> */
    public function boards(): BelongsToMany
    {
        return $this->belongsToMany(Board::class)
            ->using(BoardMember::class)
            ->withPivot(['role', 'is_favorite', 'last_opened_at'])
            ->withTimestamps();
    }

    /** @return BelongsToMany<Card, $this> */
    public function assignedCards(): BelongsToMany
    {
        return $this->belongsToMany(Card::class);
    }

    /** @return HasMany<Comment, $this> */
    public function comments(): HasMany
    {
        return $this->hasMany(Comment::class);
    }
}
