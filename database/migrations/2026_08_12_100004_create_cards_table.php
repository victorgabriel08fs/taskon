<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('cards', function (Blueprint $table) {
            $table->id();

            // board_id é desnormalizado de propósito: autorização e buscas por board
            // não precisam de join com board_lists.
            $table->foreignId('board_id')->constrained()->cascadeOnDelete();
            $table->foreignId('board_list_id')->constrained()->cascadeOnDelete();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();

            $table->string('title');
            $table->text('description')->nullable();
            $table->double('position')->default(0);

            $table->string('cover_color', 20)->nullable();
            $table->timestamp('due_at')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamp('archived_at')->nullable();
            $table->timestamps();

            $table->index(['board_list_id', 'position']);
            $table->index(['board_id', 'archived_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('cards');
    }
};
