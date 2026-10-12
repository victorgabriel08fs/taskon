import type { Metadata } from 'next';
import { SettingsLayout } from '@/components/layouts/settings-layout';
import { DeleteAccount } from '@/components/settings/delete-account';
import { ProfileForm } from '@/components/settings/profile-form';
import { requireUser } from '@/server/auth/session';
import { AVATAR_COLORS } from '@/server/config';

export const metadata: Metadata = {
    title: 'Perfil',
};

export default async function ProfilePage() {
    await requireUser();

    return (
        <SettingsLayout title="Perfil" description="Como você aparece para o resto do time.">
            <ProfileForm avatarColors={[...AVATAR_COLORS]} />
            <DeleteAccount />
        </SettingsLayout>
    );
}
