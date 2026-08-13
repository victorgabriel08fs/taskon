import { Head, Link, usePage } from '@inertiajs/react';
import {
    ArrowRight,
    CalendarClock,
    CheckCircle2,
    Command,
    Layers,
    MessageSquare,
    MousePointerClick,
    Sparkles,
    Tags,
    Users,
} from 'lucide-react';
import { motion, useScroll, useSpring, useTransform } from 'motion/react';
import { useRef } from 'react';
import { Logo } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { useReveal } from '@/hooks/use-reveal';

const FEATURES = [
    {
        icon: MousePointerClick,
        title: 'Arraste e solte de verdade',
        body: 'Cards e colunas se movem com física de mola, auto-scroll nas bordas e um "fantasma" que segue o cursor. Teclado também funciona.',
    },
    {
        icon: Sparkles,
        title: 'Resposta instantânea',
        body: 'A interface aplica a mudança na hora e sincroniza com o servidor depois. Se algo falhar, ela volta sozinha ao estado anterior.',
    },
    {
        icon: Tags,
        title: 'Etiquetas e capas',
        body: 'Dez cores, nomes livres e filtros que escondem o ruído para você ver só o que importa agora.',
    },
    {
        icon: CheckCircle2,
        title: 'Checklists com progresso',
        body: 'Barra de progresso animada, itens marcáveis em um clique e contagem visível direto no card.',
    },
    {
        icon: MessageSquare,
        title: 'Comentários e histórico',
        body: 'Toda ação no quadro entra num feed de atividades. Nada se perde entre uma reunião e outra.',
    },
    {
        icon: Users,
        title: 'Time no mesmo quadro',
        body: 'Convide por e-mail, defina quem administra e atribua responsáveis por card.',
    },
];

const SHORTCUTS = [
    ['Esc', 'Fecha modais e edições'],
    ['Enter', 'Salva e abre o próximo campo'],
    ['Shift + Enter', 'Quebra de linha na descrição'],
    ['Espaço', 'Pega o card no modo teclado'],
];

export default function Welcome() {
    const user = usePage().props.auth.user;
    const heroRef = useRef<HTMLDivElement>(null);

    // Scroll global → barra de progresso no topo.
    const { scrollYProgress } = useScroll();
    const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 30, restDelta: 0.001 });

    // Scroll do hero → parallax em camadas com velocidades diferentes.
    const { scrollYProgress: heroProgress } = useScroll({
        target: heroRef,
        offset: ['start start', 'end start'],
    });
    const blobY = useTransform(heroProgress, [0, 1], ['0%', '55%']);
    const contentY = useTransform(heroProgress, [0, 1], ['0%', '28%']);
    const contentOpacity = useTransform(heroProgress, [0, 0.75], [1, 0]);
    const previewY = useTransform(heroProgress, [0, 1], ['0%', '-14%']);
    const previewRotate = useTransform(heroProgress, [0, 1], [0, -4]);

    const featuresRef = useReveal<HTMLDivElement>();
    const shortcutsRef = useReveal<HTMLDivElement>();
    const ctaRef = useReveal<HTMLDivElement>();

    return (
        <>
            <Head title="Organize qualquer coisa, arrastando" />

            <motion.div
                style={{ scaleX: progress }}
                className="fixed inset-x-0 top-0 z-50 h-0.5 origin-left bg-gradient-to-r from-violet-500 via-fuchsia-500 to-pink-400"
            />

            <div className="min-h-dvh bg-background">
                <header className="sticky top-0 z-40 border-b border-border glass">
                    <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
                        <Logo />

                        <div className="flex items-center gap-2">
                            <ThemeToggle className="hidden sm:inline-flex" />

                            {user ? (
                                <Link href="/dashboard">
                                    <Button>
                                        Meus quadros
                                        <ArrowRight className="size-4" />
                                    </Button>
                                </Link>
                            ) : (
                                <>
                                    <Link href="/login">
                                        <Button variant="ghost">Entrar</Button>
                                    </Link>
                                    <Link href="/register">
                                        <Button>
                                            Começar grátis
                                            <ArrowRight className="size-4" />
                                        </Button>
                                    </Link>
                                </>
                            )}
                        </div>
                    </div>
                </header>

                {/* ---------------------------------------------------------------- Hero */}
                <section ref={heroRef} className="relative overflow-hidden">
                    <motion.div style={{ y: blobY }} className="pointer-events-none absolute inset-0 -z-10">
                        <div className="absolute -left-32 top-0 size-[32rem] rounded-full bg-violet-500/22 blur-3xl" />
                        <div className="absolute right-0 top-32 size-[26rem] rounded-full bg-fuchsia-500/18 blur-3xl" />
                        <div className="absolute bottom-0 left-1/3 size-[22rem] rounded-full bg-sky-400/18 blur-3xl" />
                    </motion.div>

                    <div className="mx-auto max-w-6xl px-5 pb-24 pt-20 sm:pt-28">
                        <motion.div style={{ y: contentY, opacity: contentOpacity }} className="mx-auto max-w-3xl text-center">
                            <motion.span
                                initial={{ opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.5 }}
                                className="inline-flex items-center gap-2 rounded-full bg-primary-soft px-3.5 py-1.5 text-xs font-semibold text-primary ring-1 ring-primary/20"
                            >
                                <Sparkles className="size-3.5" />
                                Kanban local, sem nuvem, sem assinatura
                            </motion.span>

                            <motion.h1
                                initial={{ opacity: 0, y: 22 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.65, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
                                className="mt-6 text-balance text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl"
                            >
                                Organize qualquer coisa,{' '}
                                <span className="text-gradient">arrastando</span>.
                            </motion.h1>

                            <motion.p
                                initial={{ opacity: 0, y: 22 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.65, delay: 0.14, ease: [0.22, 1, 0.36, 1] }}
                                className="mx-auto mt-5 max-w-xl text-pretty text-lg text-muted-fg"
                            >
                                Um clone do Trello que roda na sua máquina: quadros, listas, cards, etiquetas,
                                checklists e comentários — com a fluidez que você espera de um app nativo.
                            </motion.p>

                            <motion.div
                                initial={{ opacity: 0, y: 22 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.65, delay: 0.22, ease: [0.22, 1, 0.36, 1] }}
                                className="mt-9 flex flex-wrap items-center justify-center gap-3"
                            >
                                <Link href={user ? '/dashboard' : '/register'}>
                                    <Button size="lg" className="shadow-lg shadow-primary/25">
                                        {user ? 'Abrir meus quadros' : 'Criar meu primeiro quadro'}
                                        <ArrowRight className="size-4" />
                                    </Button>
                                </Link>

                                <a href="#recursos">
                                    <Button size="lg" variant="secondary">
                                        Ver os recursos
                                    </Button>
                                </a>
                            </motion.div>
                        </motion.div>

                        <motion.div
                            style={{ y: previewY, rotate: previewRotate }}
                            initial={{ opacity: 0, y: 60, scale: 0.96 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            transition={{ duration: 0.9, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
                            className="mt-16 [perspective:1600px]"
                        >
                            <BoardPreview />
                        </motion.div>
                    </div>
                </section>

                {/* ----------------------------------------------------------- Recursos */}
                <section id="recursos" className="border-t border-border bg-surface-2/40 py-24">
                    <div ref={featuresRef} className="mx-auto max-w-6xl px-5">
                        <div data-reveal className="reveal mx-auto max-w-2xl text-center">
                            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                                Tudo que um quadro precisa ter
                            </h2>
                            <p className="mt-4 text-muted-fg">
                                Sem menu escondido, sem tela de carregamento. Cada interação responde no mesmo frame.
                            </p>
                        </div>

                        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                            {FEATURES.map(({ icon: Icon, title, body }, index) => (
                                <div
                                    key={title}
                                    data-reveal
                                    className="reveal group rounded-xl bg-surface p-6 ring-1 ring-border transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[var(--shadow-float)] hover:ring-primary/30"
                                    style={{ transitionDelay: `${index * 60}ms` }}
                                >
                                    <span className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3">
                                        <Icon className="size-5" />
                                    </span>
                                    <h3 className="mt-5 font-semibold">{title}</h3>
                                    <p className="mt-2 text-sm leading-relaxed text-muted-fg">{body}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                {/* ---------------------------------------------------------- Atalhos */}
                <section className="py-24">
                    <div ref={shortcutsRef} className="mx-auto grid max-w-6xl items-center gap-14 px-5 lg:grid-cols-2">
                        <div data-reveal className="reveal">
                            <span className="inline-flex items-center gap-2 rounded-full bg-surface-2 px-3 py-1.5 text-xs font-semibold text-muted-fg ring-1 ring-border">
                                <Command className="size-3.5" />
                                Feito para o teclado
                            </span>

                            <h2 className="mt-6 text-3xl font-bold tracking-tight sm:text-4xl">
                                Suas mãos não precisam sair do lugar
                            </h2>
                            <p className="mt-4 text-muted-fg">
                                Adicionar card, renomear lista, marcar item de checklist — tudo tem caminho por teclado.
                                O drag and drop também é acessível: foco no card, espaço para pegar, setas para mover.
                            </p>

                            <dl className="mt-8 space-y-3">
                                {SHORTCUTS.map(([key, description]) => (
                                    <div key={key} className="flex items-center gap-4">
                                        <dt>
                                            <kbd className="rounded-md bg-surface-2 px-2.5 py-1.5 font-mono text-xs font-semibold ring-1 ring-border">
                                                {key}
                                            </kbd>
                                        </dt>
                                        <dd className="text-sm text-muted-fg">{description}</dd>
                                    </div>
                                ))}
                            </dl>
                        </div>

                        <div data-reveal className="reveal grid gap-4 sm:grid-cols-2">
                            <StatCard icon={Layers} value="∞" label="Quadros e listas" />
                            <StatCard icon={CalendarClock} value="0 ms" label="Espera ao arrastar" />
                            <StatCard icon={CheckCircle2} value="100%" label="Local, sem nuvem" />
                            <StatCard icon={Users} value="Multi" label="Usuários por quadro" />
                        </div>
                    </div>
                </section>

                {/* -------------------------------------------------------------- CTA */}
                <section className="px-5 pb-24">
                    <div
                        ref={ctaRef}
                        className="reveal relative mx-auto max-w-5xl overflow-hidden rounded-2xl bg-gradient-to-br from-violet-600 via-fuchsia-600 to-pink-500 px-8 py-16 text-center text-white"
                    >
                        <div className="absolute -left-16 -top-16 size-64 animate-float rounded-full bg-white/12 blur-2xl" />
                        <div
                            className="absolute -bottom-20 -right-10 size-72 animate-float rounded-full bg-white/12 blur-2xl"
                            style={{ animationDelay: '-3.5s' }}
                        />

                        <h2 className="relative text-3xl font-bold tracking-tight sm:text-4xl">
                            Seu próximo quadro está a um clique
                        </h2>
                        <p className="relative mx-auto mt-4 max-w-lg text-white/85">
                            Crie a conta, receba um quadro de exemplo já preenchido e comece a arrastar.
                        </p>

                        <div className="relative mt-8 flex justify-center">
                            <Link href={user ? '/dashboard' : '/register'}>
                                <Button size="lg" variant="glass" className="bg-white/90! text-violet-700! ring-white/40">
                                    {user ? 'Ir para meus quadros' : 'Criar conta gratuita'}
                                    <ArrowRight className="size-4" />
                                </Button>
                            </Link>
                        </div>
                    </div>
                </section>

                <footer className="border-t border-border py-10">
                    <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 sm:flex-row">
                        <Logo />
                        <p className="text-sm text-muted-fg">
                            Laravel {'·'} Inertia {'·'} React {'·'} Tailwind — rodando em localhost.
                        </p>
                    </div>
                </footer>
            </div>
        </>
    );
}

function StatCard({ icon: Icon, value, label }: { icon: typeof Layers; value: string; label: string }) {
    return (
        <div className="rounded-xl bg-surface p-6 ring-1 ring-border transition-transform duration-300 hover:-translate-y-1">
            <Icon className="size-5 text-primary" />
            <p className="mt-4 text-3xl font-bold tracking-tight">{value}</p>
            <p className="mt-1 text-sm text-muted-fg">{label}</p>
        </div>
    );
}

/** Mock estático do quadro — vale mais que um parágrafo explicando o produto. */
function BoardPreview() {
    const columns: {
        title: string;
        cards: { title: string; labels: string[]; meta: string | null; lifted?: boolean; done?: boolean }[];
    }[] = [
        {
            title: 'A fazer',
            cards: [
                { title: 'Revisar textos da home', labels: ['bg-violet-500'], meta: '2/5' },
                { title: 'Configurar backup', labels: ['bg-blue-500', 'bg-rose-500'], meta: null },
            ],
        },
        {
            title: 'Em andamento',
            cards: [
                { title: 'Arrastar e soltar entre colunas', labels: ['bg-emerald-500'], meta: '1/3', lifted: true },
            ],
        },
        {
            title: 'Concluído',
            cards: [{ title: 'Instalar o Taskon', labels: ['bg-amber-500'], meta: null, done: true }],
        },
    ];

    return (
        <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 p-2.5 shadow-[var(--shadow-float)] ring-1 ring-black/10">
            <div className="flex items-center gap-2 px-2 py-2">
                <span className="size-2.5 rounded-full bg-white/35" />
                <span className="size-2.5 rounded-full bg-white/35" />
                <span className="size-2.5 rounded-full bg-white/35" />
                <span className="ml-2 text-xs font-medium text-white/80">Lançamento do Taskon</span>
            </div>

            <div className="flex gap-3 overflow-hidden rounded-xl p-3">
                {columns.map((column, columnIndex) => (
                    <motion.div
                        key={column.title}
                        initial={{ opacity: 0, y: 24 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ delay: 0.15 + columnIndex * 0.1, duration: 0.5 }}
                        className="w-56 shrink-0 rounded-xl bg-white/92 p-2.5 backdrop-blur dark:bg-slate-900/85"
                    >
                        <p className="px-1 pb-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                            {column.title}
                        </p>

                        <div className="space-y-2">
                            {column.cards.map((card) => (
                                <motion.div
                                    key={card.title}
                                    animate={
                                        card.lifted
                                            ? { rotate: [0, -2.5, 0], y: [0, -6, 0] }
                                            : undefined
                                    }
                                    transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
                                    className="rounded-lg bg-white p-2.5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700"
                                >
                                    <div className="flex gap-1">
                                        {card.labels.map((label) => (
                                            <span key={label} className={`h-1.5 w-7 rounded-full ${label}`} />
                                        ))}
                                    </div>

                                    <p
                                        className={`mt-2 text-xs font-medium text-slate-700 dark:text-slate-200 ${
                                            card.done ? 'line-through opacity-60' : ''
                                        }`}
                                    >
                                        {card.title}
                                    </p>

                                    {card.meta && (
                                        <p className="mt-1.5 text-[10px] font-semibold text-slate-400">☑ {card.meta}</p>
                                    )}
                                </motion.div>
                            ))}
                        </div>
                    </motion.div>
                ))}
            </div>
        </div>
    );
}
