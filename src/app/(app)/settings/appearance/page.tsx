import type { Metadata } from 'next';
import { SettingsLayout } from '@/components/layouts/settings-layout';
import { AppearancePicker } from '@/components/settings/appearance-picker';
import { requireUser } from '@/server/auth/session';

export const metadata: Metadata = {
    title: 'Aparência',
};

export default async function AppearancePage() {
    await requireUser();

    return (
        <SettingsLayout title="Aparência" description="A escolha fica salva neste navegador.">
            <AppearancePicker />
        </SettingsLayout>
    );
}
