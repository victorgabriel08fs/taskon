<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('boards', function (Blueprint $table) {
            // Dias entre concluir o card e ele sair da coluna. null = desligado,
            // que é o estado de todo quadro existente e de todo quadro novo:
            // fazer cards sumirem sozinhos precisa ser uma decisão consciente.
            $table->unsignedSmallInteger('auto_archive_done_after_days')->nullable()->after('background');
        });

        // A varredura filtra por (board_id, archived_at, completed_at). O índice
        // de cards já cobre os dois primeiros; o terceiro entra aqui para a
        // consulta não varrer o quadro inteiro toda madrugada.
        Schema::table('cards', function (Blueprint $table) {
            $table->index(['board_id', 'archived_at', 'completed_at'], 'cards_archive_sweep_index');
        });
    }

    public function down(): void
    {
        Schema::table('cards', function (Blueprint $table) {
            $table->dropIndex('cards_archive_sweep_index');
        });

        Schema::table('boards', function (Blueprint $table) {
            $table->dropColumn('auto_archive_done_after_days');
        });
    }
};
