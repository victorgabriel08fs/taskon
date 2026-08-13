<?php

use App\Http\Controllers\Settings\AppearanceController;
use App\Http\Controllers\Settings\NotificationController;
use App\Http\Controllers\Settings\PasswordController;
use App\Http\Controllers\Settings\ProfileController;
use Illuminate\Support\Facades\Route;

Route::middleware('auth')->prefix('settings')->group(function () {
    Route::redirect('/', '/settings/profile');

    Route::get('profile', [ProfileController::class, 'edit'])->name('profile.edit');
    Route::patch('profile', [ProfileController::class, 'update'])->name('profile.update');
    Route::delete('profile', [ProfileController::class, 'destroy'])->name('profile.destroy');

    Route::get('password', [PasswordController::class, 'edit'])->name('password.edit');
    Route::put('password', [PasswordController::class, 'update'])->name('password.update')->middleware('throttle:6,1');

    Route::get('notifications', [NotificationController::class, 'edit'])->name('notifications.edit');
    Route::patch('notifications', [NotificationController::class, 'update'])->name('notifications.update');
    // O envio de teste bate no Resend de verdade — throttle para o botão não
    // virar um gerador de e-mail (e de custo).
    Route::post('notifications/test', [NotificationController::class, 'test'])
        ->name('notifications.test')
        ->middleware('throttle:3,1');

    Route::get('appearance', [AppearanceController::class, 'edit'])->name('appearance.edit');
});
