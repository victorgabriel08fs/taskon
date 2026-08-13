<?php

namespace Database\Seeders;

use App\Models\Board;
use App\Models\BoardList;
use App\Models\Card;
use App\Models\User;
use App\Support\DemoBoardBuilder;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    public function run(): void
    {
        $victor = User::factory()->create([
            'name' => 'Victor',
            'email' => 'victor@taskon.test',
            'title' => 'Product Owner',
            'avatar_color' => 'violet',
        ]);

        $colega = User::factory()->create([
            'name' => 'Ana Souza',
            'email' => 'ana@taskon.test',
            'title' => 'Designer',
            'avatar_color' => 'rose',
        ]);

        $board = DemoBoardBuilder::for($victor, 'Lançamento do Taskon');
        $board->members()->attach($colega->id, ['role' => 'admin']);

        DemoBoardBuilder::for($victor, 'Pessoal');

        $this->paintHistory($board, $victor, $colega);

        $this->command?->info('Usuários: victor@taskon.test / ana@taskon.test — senha: password');
    }

    /**
     * Espalha cards pelas últimas duas semanas.
     *
     * Sem isso o painel abre com tudo criado hoje: o gráfico de ritmo vira uma
     * linha reta no zero com um pico no fim, e o anel de prazos não tem
     * vencidas. É dado de demonstração, mas precisa demonstrar alguma coisa.
     *
     * As datas são fixas de propósito — seed com rand() dá um painel diferente
     * a cada `migrate:fresh --seed`, e aí não dá para comparar nada.
     */
    private function paintHistory(Board $board, User $victor, User $ana): void
    {
        $done = $board->lists()->firstWhere('title', 'Concluído');
        $doing = $board->lists()->firstWhere('title', 'Em andamento');
        $todo = $board->lists()->firstWhere('title', 'A fazer');

        // [título, dias atrás em que foi criado, dias atrás em que concluiu, dono]
        $concluidos = [
            ['Definir a paleta do tema escuro', 13, 11, $ana],
            ['Fechar o contrato dos resources', 12, 11, $victor],
            ['Escrever as policies do quadro', 11, 9, $victor],
            ['Revisar o contraste dos botões', 9, 8, $ana],
            ['Publicar a página inicial', 8, 6, $victor],
            ['Ajustar o arrastar no celular', 6, 5, $ana],
            ['Trocar os ícones do cabeçalho', 5, 4, $victor],
            ['Cortar o flash do tema no F5', 4, 2, $victor],
            ['Subir o Mailpit central', 2, 1, $victor],
        ];

        foreach ($concluidos as $index => [$title, $criado, $concluido, $dono]) {
            $this->card($done, $title, $dono, $index + 10, [
                'created_at' => now()->subDays($criado)->setTime(9, 30),
                'completed_at' => now()->subDays($concluido)->setTime(17, 0),
            ]);
        }

        // O incêndio: sem nada vencido, metade do painel fica sem graça e o
        // e-mail diário nunca mostra o estado que ele existe para mostrar.
        $atrasados = [
            ['Renovar o certificado de tasks.localhost', 3, 1],
            ['Responder o feedback da Ana no protótipo', 6, 2],
        ];

        foreach ($atrasados as $index => [$title, $criado, $venceu]) {
            $this->card($todo, $title, $victor, $index + 20, [
                'created_at' => now()->subDays($criado)->setTime(11, 0),
                'due_at' => now()->subDays($venceu)->setTime(18, 0),
            ]);
        }

        $this->card($doing, 'Fechar o relatório da sprint', $victor, 30, [
            'created_at' => now()->subDays(2)->setTime(14, 0),
            'due_at' => now()->setTime(18, 0),
        ]);
    }

    /** @param  array<string, mixed>  $attributes */
    private function card(BoardList $list, string $title, User $owner, int $position, array $attributes): void
    {
        $card = new Card(['title' => $title, 'position' => $position]);
        $card->board_id = $list->board_id;
        $card->board_list_id = $list->id;
        $card->created_by = $owner->id;

        // created_at explícito sobrevive ao save: o Eloquent só carimba o
        // timestamp quando o atributo não foi tocado.
        $card->forceFill($attributes)->save();

        $card->members()->attach($owner->id);
    }
}
