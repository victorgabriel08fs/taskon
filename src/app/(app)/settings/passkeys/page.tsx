import type { Metadata } from 'next';
import { SettingsLayout } from '@/components/layouts/settings-layout';
import { PasskeySettings } from '@/components/settings/passkey-settings';
import { requireUser } from '@/server/auth/session';
import { loadPasskeySettings } from '@/server/queries/passkeys';

export const metadata: Metadata = {
    title: 'Passkeys',
};

/** Configurações › Passkeys: entrar sem senha, com a digital, o rosto ou o PIN do aparelho. */
export default async function PasskeysPage() {
    const user = await requireUser();
    const data = await loadPasskeySettings(user);

    return (
        <SettingsLayout title="Passkeys" description="Entre com a digital, o rosto ou o PIN do aparelho, sem digitar a senha.">
            <PasskeySettings {...data} />
        </SettingsLayout>
    );
}
