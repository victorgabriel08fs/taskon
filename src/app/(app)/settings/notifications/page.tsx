import type { Metadata } from 'next';
import { SettingsLayout } from '@/components/layouts/settings-layout';
import { NotificationSettings } from '@/components/notifications/notification-settings';
import { requireUser } from '@/server/auth/session';
import { notificationSettingsFor } from '@/server/services/daily-digest';

export const metadata: Metadata = { title: 'Notificações' };

/** Configurações › Notificações — o antigo `NotificationController@edit`. */
export default async function NotificationsPage() {
    const user = await requireUser();
    const settings = await notificationSettingsFor(user);

    return (
        <SettingsLayout title="Notificações" description="Um e-mail por dia com o que está vencido e o que vence a seguir.">
            <NotificationSettings {...settings} />
        </SettingsLayout>
    );
}
