<?php

namespace App\Policies;

use App\Models\Board;
use App\Models\User;

class BoardPolicy
{
    /**
     * Qualquer membro enxerga o quadro.
     */
    public function view(User $user, Board $board): bool
    {
        return $this->roleOf($user, $board) !== null;
    }

    /**
     * Qualquer membro edita o conteúdo (listas, cards, comentários).
     */
    public function update(User $user, Board $board): bool
    {
        return $this->view($user, $board);
    }

    /**
     * Configurações do quadro, etiquetas e membros: só owner/admin.
     */
    public function manage(User $user, Board $board): bool
    {
        return in_array($this->roleOf($user, $board), ['owner', 'admin'], true);
    }

    /**
     * Excluir o quadro: apenas o dono.
     */
    public function delete(User $user, Board $board): bool
    {
        return $board->owner_id === $user->getKey();
    }

    /**
     * Papel do usuário no quadro, ou null se não for membro.
     *
     * Usa a relação já carregada quando disponível para não gerar N+1.
     */
    public function roleOf(User $user, Board $board): ?string
    {
        if ($board->relationLoaded('members')) {
            $member = $board->members->firstWhere('id', $user->getKey());

            return $member?->pivot->role;
        }

        return $board->members()
            ->whereKey($user->getKey())
            ->value('board_user.role');
    }
}
