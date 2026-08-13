<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    /**
     * Títulos que, na prática, já significavam "pronto" antes de existir a
     * marcação explícita. Só valem para o backfill — daqui para a frente quem
     * decide é a flag, não o nome da coluna.
     */
    private const DONE_TITLES = [
        'concluído', 'concluido', 'concluídos', 'concluidos',
        'done', 'completo', 'completos', 'finalizado', 'finalizados',
        'feito', 'feitos', 'pronto', 'prontos', 'entregue', 'entregues',
    ];

    public function up(): void
    {
        Schema::table('board_lists', function (Blueprint $table) {
            // Arrastar o card para esta coluna passa a marcá-lo como concluído.
            $table->boolean('is_done')->default(false)->after('card_limit');
        });

        $doneIds = DB::table('board_lists')
            ->get(['id', 'title'])
            ->filter(fn ($list) => in_array(Str::lower(trim($list->title)), self::DONE_TITLES, true))
            ->pluck('id');

        if ($doneIds->isEmpty()) {
            return;
        }

        DB::table('board_lists')->whereIn('id', $doneIds)->update(['is_done' => true]);

        // Cards que já estavam na coluna de conclusão nunca ganharam
        // completed_at — eram contados como abertos, e os com prazo apareciam
        // como vencidos no painel. updated_at é a melhor aproximação que existe
        // de quando foram parar ali.
        DB::table('cards')
            ->whereIn('board_list_id', $doneIds)
            ->whereNull('completed_at')
            ->whereNull('archived_at')
            ->update(['completed_at' => DB::raw('updated_at')]);
    }

    public function down(): void
    {
        Schema::table('board_lists', function (Blueprint $table) {
            $table->dropColumn('is_done');
        });
    }
};
