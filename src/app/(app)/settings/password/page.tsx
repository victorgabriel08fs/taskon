import type { Metadata } from 'next';
import { SettingsLayout } from '@/components/layouts/settings-layout';
import { PasswordForm } from '@/components/settings/password-form';
import { requireUser } from '@/server/auth/session';

export const metadata: Metadata = {
    title: 'Senha',
};

export default async function PasswordPage() {
    await requireUser();

    return (
        <SettingsLayout title="Senha" description="Use uma senha longa e exclusiva desta conta.">
            <PasswordForm />
        </SettingsLayout>
    );
}
