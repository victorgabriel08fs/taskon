<?php

namespace Database\Seeders;

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

        $this->command?->info('Usuários: victor@taskon.test / ana@taskon.test — senha: password');
    }
}
