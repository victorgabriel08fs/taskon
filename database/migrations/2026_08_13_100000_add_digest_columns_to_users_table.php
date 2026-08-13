<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            // Opt-out, não opt-in: quem cria a conta já recebe o resumo. O link de
            // cancelamento vai no rodapé de todo e-mail.
            $table->boolean('daily_digest')->default(true)->after('title');

            // Carimbo do último envio BEM-SUCEDIDO. É o que impede o resumo de sair
            // duas vezes quando o comando roda de novo no mesmo dia (retry manual,
            // scheduler reiniciado, dois workers subindo juntos).
            $table->timestamp('digest_last_sent_at')->nullable()->after('daily_digest');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['daily_digest', 'digest_last_sent_at']);
        });
    }
};
