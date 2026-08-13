<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('board_lists', function (Blueprint $table) {
            $table->id();
            $table->foreignId('board_id')->constrained()->cascadeOnDelete();
            $table->string('title');

            // Ordenação fracionária: mover = média entre vizinhos, sem reescrever a lista toda.
            $table->double('position')->default(0);

            $table->unsignedSmallInteger('card_limit')->nullable();
            $table->timestamp('archived_at')->nullable();
            $table->timestamps();

            $table->index(['board_id', 'position']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('board_lists');
    }
};
