import { redirect } from 'next/navigation';

/** O `Route::redirect('/', '/settings/profile')` de routes/settings.php. */
export default function SettingsPage() {
    redirect('/settings/profile');
}
