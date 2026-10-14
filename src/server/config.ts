import 'server-only';

import type { AvatarColor, BoardBackground, ColorKey } from '@/types';

/**
 * O antigo `config/taskon.php` + o pedaço de `config/app.php` que importa.
 *
 * As listas daqui são a fonte da verdade da validação no servidor. O visual
 * correspondente mora em `src/app/globals.css` (classes .board-bg-*) e em
 * `src/lib/palette.ts` (mapa chave → classes), porque o Tailwind precisa das
 * classes escritas literalmente no código para gerá-las.
 */

const env = (key: string): string | undefined => {
    const value = process.env[key];

    return value === undefined || value === '' ? undefined : value;
};

/** Horário "HH:MM" válido, ou o padrão quando o valor não é um horário. */
function clock(value: string | undefined, fallback: string): string {
    return value && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : fallback;
}

export const BACKGROUNDS = [
    'aurora',
    'sunset',
    'ocean',
    'forest',
    'candy',
    'midnight',
    'ember',
    'graphite',
] as const satisfies readonly BoardBackground[];

export const COLORS = [
    'emerald',
    'amber',
    'orange',
    'rose',
    'violet',
    'blue',
    'sky',
    'lime',
    'pink',
    'slate',
] as const satisfies readonly ColorKey[];

export const AVATAR_COLORS = [
    'violet',
    'blue',
    'emerald',
    'amber',
    'rose',
    'cyan',
    'fuchsia',
    'teal',
] as const satisfies readonly AvatarColor[];

export const config = {
    appName: env('APP_NAME') ?? 'Taskon',

    limits: {
        activitiesPerBoard: 60,
        activitiesPerCard: 20,

        // Teto da tela de arquivados. Ela é uma gaveta de resgate, não um
        // relatório: quem precisa de tudo exporta o quadro.
        archivedPerBoard: 100,
    },

    /**
     * Arquivamento automático dos concluídos. Cada quadro escolhe em quantos
     * dias um card concluído sai da coluna; sem prazo (null), nada sai.
     *
     * Quem executa é o Cron da Vercel (`vercel.json` → /api/cron/archive-done-cards).
     * O horário daqui é o que a TELA promete — mantenha-o igual ao do cron.
     */
    autoArchive: {
        at: clock(env('AUTO_ARCHIVE_AT'), '03:00'),

        // Prazos oferecidos na tela — e a lista canônica que o backend valida.
        options: [1, 3, 7, 14, 30] as const,
    },

    /**
     * Resumo diário por e-mail. O corte entre "vencida", "hoje" e "próximos
     * dias" é feito no fuso do app (`APP_TIMEZONE`), o mesmo em que os prazos
     * são interpretados.
     */
    digest: {
        // Horário do disparo, no fuso do app. O cron do vercel.json está em UTC.
        at: clock(env('DIGEST_AT'), '07:00'),

        // Quantos dias à frente entram em "próximos dias".
        horizonDays: Math.max(1, Number.parseInt(env('DIGEST_HORIZON_DAYS') ?? '7', 10) || 7),

        // Teto de cards listados por seção — o e-mail é um lembrete, não um relatório.
        maxPerSection: 8,

        // Não manda e-mail para quem não tem nada vencido, para hoje, para os
        // próximos dias nem concluído nas últimas 24 h.
        skipWhenEmpty: true,
    },

    auth: {
        /** Minutos de inatividade até a sessão (sem "lembrar de mim") expirar. */
        sessionLifetimeMinutes: Math.max(5, Number.parseInt(env('SESSION_LIFETIME') ?? '120', 10) || 120),

        /** "Lembrar de mim": 400 dias, o teto que os navegadores aceitam para cookie. */
        rememberDays: 400,

        /** Validade do link de redefinição de senha. */
        passwordResetMinutes: 60,

        /** Intervalo mínimo entre dois pedidos de link para o mesmo e-mail. */
        passwordResetThrottleSeconds: 60,

        bcryptRounds: Math.min(14, Math.max(10, Number.parseInt(env('BCRYPT_ROUNDS') ?? '12', 10) || 12)),
    },

    /**
     * Administração do Taskon (/admin).
     *
     * O admin NATIVO é a conta cujo e-mail está nesta lista — e só depois de
     * ela provar que o e-mail é dela (link de confirmação ou redefinição de
     * senha concluída). Sem essa prova, como o app não verifica e-mail no
     * cadastro, qualquer um poderia criar uma conta com o endereço e virar
     * admin: a lista está no código, e o repositório é público.
     *
     * `NATIVE_ADMIN_EMAILS` (separados por vírgula) troca a lista sem mexer
     * no código — útil no desenvolvimento, com as contas do seed.
     */
    admin: {
        nativeEmails: (env('NATIVE_ADMIN_EMAILS') ?? 'victorgabriel08fs@gmail.com')
            .split(',')
            .map((email) => email.trim().toLowerCase())
            .filter(Boolean),

        /** Pessoas por página na lista do painel. */
        usersPerPage: 25,

        /** Linhas do histórico de administração mostradas no painel. */
        eventsShown: 20,

        /** Validade do link de confirmação de e-mail. */
        emailVerificationMinutes: 24 * 60,
    },

    /** Convites por e-mail para quem ainda não tem conta. */
    invitations: {
        /** Quantos dias o link do convite vale. Convidar de novo renova o prazo. */
        expiresInDays: 7,

        // Cada convite manda um e-mail para um endereço que a pessoa digitou:
        // sem teto, o botão vira um disparador de e-mail (e de custo no Resend,
        // e de reputação do domínio). Por quem convida, por hora.
        maxPerHour: 20,
    },
} as const;

export type AutoArchiveOption = (typeof config.autoArchive.options)[number];

/**
 * A URL pública do app, para links absolutos (e-mails, List-Unsubscribe).
 *
 * Ordem: APP_URL explícito → domínio de produção que a Vercel injeta → URL do
 * deploy atual → localhost.
 */
export function appUrl(path = ''): string {
    const base =
        env('APP_URL') ??
        (env('VERCEL_PROJECT_PRODUCTION_URL') ? `https://${env('VERCEL_PROJECT_PRODUCTION_URL')}` : undefined) ??
        (env('VERCEL_URL') ? `https://${env('VERCEL_URL')}` : undefined) ??
        'http://localhost:3000';

    return base.replace(/\/+$/, '') + path;
}

export const isProduction = process.env.NODE_ENV === 'production';
