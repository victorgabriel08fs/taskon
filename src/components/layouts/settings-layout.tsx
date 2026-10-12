'use client';

import { Bell, Palette, ShieldCheck, UserRound } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppLayout } from '@/components/layouts/app-layout';
import { cn } from '@/lib/utils';

const TABS = [
    { href: '/settings/profile', label: 'Perfil', icon: UserRound },
    { href: '/settings/password', label: 'Senha', icon: ShieldCheck },
    { href: '/settings/notifications', label: 'Notificações', icon: Bell },
    { href: '/settings/appearance', label: 'Aparência', icon: Palette },
];

/**
 * A moldura das telas de configuração: abas à esquerda (em cima, no mobile)
 * e a seção atual à direita, dentro do AppLayout.
 */
export function SettingsLayout({
    title,
    description,
    children,
}: {
    title: string;
    description: string;
    children: ReactNode;
}) {
    const current = usePathname();

    return (
        <AppLayout>
            <div className="mx-auto w-full max-w-4xl px-5 py-10">
                <h1 className="text-2xl font-bold tracking-tight">Configurações</h1>
                <p className="mt-1 text-sm text-muted-fg">Ajustes da sua conta e da interface.</p>

                <div className="mt-8 grid gap-8 md:grid-cols-[190px_1fr]">
                    <nav className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
                        {TABS.map(({ href, label, icon: Icon }) => (
                            <Link
                                key={href}
                                href={href}
                                aria-current={current === href ? 'page' : undefined}
                                className={cn(
                                    'flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150',
                                    current === href
                                        ? 'bg-primary-soft text-primary'
                                        : 'text-muted-fg hover:bg-surface-2 hover:text-foreground',
                                )}
                            >
                                <Icon className="size-4" />
                                {label}
                            </Link>
                        ))}
                    </nav>

                    <section className="min-w-0">
                        <header className="mb-6">
                            <h2 className="text-lg font-semibold">{title}</h2>
                            <p className="mt-0.5 text-sm text-muted-fg">{description}</p>
                        </header>

                        {children}
                    </section>
                </div>
            </div>
        </AppLayout>
    );
}
