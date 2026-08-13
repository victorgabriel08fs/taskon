import { Link } from '@inertiajs/react';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { Logo } from '@/components/logo';

export default function AuthLayout({
    title,
    description,
    children,
}: {
    title: string;
    description: string;
    children: ReactNode;
}) {
    return (
        <div className="relative grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
            {/* Painel decorativo — some no mobile para não roubar espaço do formulário. */}
            <div className="relative hidden overflow-hidden bg-gradient-to-br from-violet-600 via-fuchsia-600 to-pink-500 lg:block">
                <div className="absolute -left-24 top-1/4 size-96 animate-float rounded-full bg-white/15 blur-3xl" />
                <div
                    className="absolute -right-16 bottom-10 size-80 animate-float rounded-full bg-sky-300/25 blur-3xl"
                    style={{ animationDelay: '-3s' }}
                />

                <div className="relative flex h-full flex-col justify-between p-12 text-white">
                    <Link href="/" className="w-fit">
                        <Logo invert />
                    </Link>

                    <div className="max-w-md">
                        <motion.h2
                            initial={{ opacity: 0, y: 24 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                            className="text-4xl font-bold leading-tight tracking-tight"
                        >
                            Organize qualquer coisa,
                            <br />
                            arrastando.
                        </motion.h2>

                        <motion.p
                            initial={{ opacity: 0, y: 24 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.7, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
                            className="mt-4 text-lg text-white/80"
                        >
                            Quadros, listas e cards com a fluidez de um app nativo — rodando na sua máquina.
                        </motion.p>
                    </div>

                    <p className="text-sm text-white/60">Feito com Laravel, Inertia e React.</p>
                </div>
            </div>

            <div className="flex items-center justify-center bg-background px-6 py-12">
                <motion.div
                    initial={{ opacity: 0, y: 18 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                    className="w-full max-w-sm"
                >
                    <Link href="/" className="mb-8 inline-flex lg:hidden">
                        <Logo />
                    </Link>

                    <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
                    <p className="mt-1.5 text-sm text-muted-fg">{description}</p>

                    <div className="mt-8">{children}</div>
                </motion.div>
            </div>
        </div>
    );
}
