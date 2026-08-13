import { Link, router, usePage } from '@inertiajs/react';
import { ChartNoAxesColumn, LayoutDashboard, LogOut, Settings, SquareKanban, UserRound } from 'lucide-react';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Logo } from '@/components/logo';
import { Popover, PopoverItem } from '@/components/ui/popover';
import { ThemeToggle } from '@/components/theme-toggle';
import { cn } from '@/lib/utils';

interface AppLayoutProps {
    children: ReactNode;
    /** No quadro o cabeçalho flutua sobre o gradiente em vez de ter fundo próprio. */
    overlay?: boolean;
    /** Conteúdo extra no centro do cabeçalho (título do quadro, ações...). */
    headerSlot?: ReactNode;
    className?: string;
}

const NAV = [
    { href: '/dashboard', label: 'Painel', icon: ChartNoAxesColumn },
    { href: '/boards', label: 'Quadros', icon: SquareKanban },
];

export default function AppLayout({ children, overlay = false, headerSlot, className }: AppLayoutProps) {
    const user = usePage().props.auth.user;

    return (
        // No quadro a altura é fixa (h-dvh): as colunas precisam de um limite
        // concreto para o scroll interno funcionar.
        <div className={cn('flex flex-col', overlay ? 'h-dvh overflow-hidden' : 'min-h-dvh bg-background')}>
            <header
                className={cn(
                    'sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 px-3 sm:px-5',
                    overlay
                        ? 'border-b border-white/12 bg-black/22 backdrop-blur-xl'
                        : 'border-b border-border glass',
                )}
            >
                <Link
                    href="/dashboard"
                    className="shrink-0 rounded-lg transition-transform duration-200 hover:scale-[1.03] active:scale-95"
                >
                    <Logo invert={overlay} className={cn(overlay && 'drop-shadow')} />
                </Link>

                {/* No quadro o cabeçalho já é do quadro: o título e as ações
                    dele ocupam esse espaço, e a navegação sairia sobrando. */}
                {!overlay && user && <MainNav />}

                <div className="min-w-0 flex-1">{headerSlot}</div>

                <div className="flex shrink-0 items-center gap-2">
                    <ThemeToggle className={cn(overlay && 'bg-white/12 ring-white/20')} />

                    {user && (
                        <Popover
                            align="right"
                            className="w-60"
                            trigger={({ toggle }) => (
                                <button
                                    type="button"
                                    onClick={toggle}
                                    className="rounded-full transition-transform duration-200 hover:scale-105 active:scale-95"
                                    aria-label="Menu da conta"
                                >
                                    <Avatar user={user} size="md" ring={overlay} />
                                </button>
                            )}
                        >
                            {() => (
                                <>
                                    <div className="flex items-center gap-3 px-2.5 py-2">
                                        <Avatar user={user} size="md" />
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-semibold">{user.name}</p>
                                            <p className="truncate text-xs text-muted-fg">{user.email}</p>
                                        </div>
                                    </div>

                                    <div className="my-1.5 h-px bg-border" />

                                    <Link href="/dashboard" className="block">
                                        <PopoverItem icon={<LayoutDashboard className="size-4" />}>
                                            Painel
                                        </PopoverItem>
                                    </Link>
                                    <Link href="/boards" className="block">
                                        <PopoverItem icon={<SquareKanban className="size-4" />}>
                                            Meus quadros
                                        </PopoverItem>
                                    </Link>
                                    <Link href="/settings/profile" className="block">
                                        <PopoverItem icon={<UserRound className="size-4" />}>Perfil</PopoverItem>
                                    </Link>
                                    <Link href="/settings/appearance" className="block">
                                        <PopoverItem icon={<Settings className="size-4" />}>Preferências</PopoverItem>
                                    </Link>

                                    <div className="my-1.5 h-px bg-border" />

                                    <PopoverItem
                                        danger
                                        icon={<LogOut className="size-4" />}
                                        onClick={() => router.post('/logout')}
                                    >
                                        Sair
                                    </PopoverItem>
                                </>
                            )}
                        </Popover>
                    )}
                </div>
            </header>

            <main className={cn('flex min-h-0 flex-1 flex-col', className)}>{children}</main>
        </div>
    );
}

/**
 * A pílula ativa é um único elemento compartilhado entre os itens (layoutId):
 * o motion interpola a posição dela de um para o outro, então trocar de aba
 * desliza em vez de piscar.
 */
function MainNav() {
    const current = usePage().url.split('?')[0];

    return (
        <nav className="flex shrink-0 items-center gap-0.5 rounded-lg bg-surface-2 p-0.5">
            {NAV.map(({ href, label, icon: Icon }) => {
                const active = current === href || (href === '/boards' && current.startsWith('/boards'));

                return (
                    <Link
                        key={href}
                        href={href}
                        prefetch="hover"
                        cacheFor="20s"
                        className={cn(
                            'relative flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors duration-200',
                            active ? 'text-foreground' : 'text-muted-fg hover:text-foreground',
                        )}
                    >
                        {active && (
                            <motion.span
                                layoutId="nav-pill"
                                transition={{ type: 'spring', stiffness: 480, damping: 38 }}
                                className="absolute inset-0 rounded-md bg-surface shadow-sm"
                            />
                        )}
                        <Icon className="relative size-4" />
                        <span className="relative hidden sm:inline">{label}</span>
                    </Link>
                );
            })}
        </nav>
    );
}
