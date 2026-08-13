<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('boards', function (Blueprint $table) {
            $table->id();
            $table->foreignId('owner_id')->constrained('users')->cascadeOnDelete();
            $table->string('title');
            $table->text('description')->nullable();

            // Chave de um preset de gradiente definido em config/taskon.php.
            $table->string('background', 40)->default('aurora');

            $table->timestamp('archived_at')->nullable();
            $table->timestamps();

            $table->index(['owner_id', 'archived_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('boards');
    }
};
