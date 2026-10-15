import { readFileSync } from 'node:fs';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdminEvent, AdminPanelData, AdminUserRow } from '@/types';
import { AccountBadges } from '@/components/admin/account-badges';
import { AdminHistory } from '@/components/admin/admin-history';
import { AdminPanel } from '@/components/admin/admin-panel';

/**
 * Regressões da revisão do painel /admin, na tela:
 *
 *  1. no histórico, o e-mail do alvo e o "há 2 horas" dividiam o mesmo span com
 *     `truncate`: com um e-mail comprido (uns 33 caracteres já bastam a 390 px)
 *     a reticência engolia o horário inteiro, e o "quando" do registro de
 *     auditoria sumia no celular. Agora só o e-mail encolhe e corta; o horário
 *     fica fora da caixa que corta, e não encolhe;
 *  2. os selos "Admin" e "Bloqueado", e o do cabeçalho para o admin concedido,
 *     levavam o texto na cor do selo sobre a tinta da mesma cor: uns 4:1, abaixo
 *     dos 4,5:1 do WCAG (1.4.3) — texto de 11-12 px não conta como texto grande.
 *     A linha de baixo de cada evento do histórico, com `opacity-80`, ficava em
 *     3,8:1. O texto agora vai em `foreground` e a cor fica no ícone, como já
 *     era no selo "Aguardando confirmação"; a linha perdeu o `opacity-80`.
 *
 * Sem jsdom (BOAS_PRATICAS, 9.5): os componentes viram HTML pelo
 * `renderToStaticMarkup`, e o contraste sai dos tokens de verdade do
 * globals.css, nos dois temas — um token trocado que derrube algum desses
 * textos abaixo do mínimo também quebra aqui.
 */

// Fora do App Router não há roteador montado, e o painel só o usa ao navegar.
vi.mock('next/navigation', async (importOriginal) => ({
    ...(await importOriginal<typeof import('next/navigation')>()),
    useRouter: () => ({ push: () => {} }),
    usePathname: () => '/admin',
}));

const NOW = '2026-10-14T15:00:00.000Z';
const LONG_EMAIL = 'maria.fernanda.albuquerque@empresaexemplo.com.br';

function account(overrides: Partial<AdminUserRow>): AdminUserRow {
    return {
        id: 2,
        name: 'Maria Fernanda Albuquerque',
        email: LONG_EMAIL,
        initials: 'MA',
        avatar_color: 'violet',
        created_at: NOW,
        last_seen_at: null,
        boards_count: 0,
        email_verified: true,
        role: 'user',
        blocked_at: null,
        blocked_by: null,
        can: { grant_admin: false, revoke_admin: false, block: false, unblock: false },
        ...overrides,
    };
}

function event(overrides: Partial<AdminEvent> = {}): AdminEvent {
    return {
        id: 1,
        type: 'user.blocked',
        actor: 'Victor Gabriel',
        target_name: 'Maria Fernanda Albuquerque',
        target_email: LONG_EMAIL,
        created_at: NOW,
        ...overrides,
    };
}

function panel(access: AdminPanelData['viewer']['access']): AdminPanelData {
    return {
        viewer: { access },
        stats: { users: 1, admins: 1, blocked: 0, new_this_week: 0, boards: 0, cards: 0 },
        users: [],
        pagination: { page: 1, per_page: 25, total: 0, pages: 1 },
        filters: { q: '', filter: 'all' },
        events: [],
    };
}

/* -------------------------------------------------------------------------- */
/* O HTML como árvore                                                          */
/* -------------------------------------------------------------------------- */

interface El {
    tag: string;
    classes: string[];
    parent: El | null;
    children: (El | string)[];
}

const VOID_TAGS = new Set('area base br col embed hr img input link meta source track wbr'.split(' '));

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#x27': "'", '#39': "'" };

function decode(text: string): string {
    return text.replace(/&(amp|lt|gt|quot|#x27|#39);/g, (_, entity: string) => ENTITIES[entity] ?? '');
}

/**
 * O HTML do `renderToStaticMarkup` como uma árvore mínima. Ele sai bem formado
 * — atributos entre aspas duplas, com `<`, `>` e `"` escapados —, então uma
 * expressão regular por marca dá conta.
 */
function render(element: ReactElement): El {
    const root: El = { tag: '#root', classes: [], parent: null, children: [] };
    let current = root;

    for (const match of renderToStaticMarkup(element).matchAll(
        /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>|([^<]+)|<!--[\s\S]*?-->/g,
    )) {
        const [, closing, tag, attributes = '', selfClosing, text] = match as (string | undefined)[];

        if (text !== undefined) {
            current.children.push(decode(text));
        } else if (tag === undefined) {
            continue;
        } else if (closing) {
            current = current.parent ?? root;
        } else {
            const className = /(?:^|\s)class="([^"]*)"/.exec(attributes)?.[1] ?? '';
            const el: El = {
                tag,
                classes: decode(className).split(/\s+/).filter(Boolean),
                parent: current,
                children: [],
            };

            current.children.push(el);

            if (!selfClosing && !VOID_TAGS.has(tag)) current = el;
        }
    }

    return root;
}

function* descendants(el: El): Generator<El> {
    for (const child of el.children) {
        if (typeof child === 'string') continue;

        yield child;
        yield* descendants(child);
    }
}

/** O elemento e os ancestrais dele, de dentro para fora. */
function lineage(el: El): El[] {
    const chain: El[] = [];

    for (let node: El | null = el; node; node = node.parent) chain.push(node);

    return chain;
}

/** O texto do próprio elemento, sem o dos filhos. */
function ownText(el: El): string {
    return el.children
        .filter((child) => typeof child === 'string')
        .join('')
        .trim();
}

function texts(root: El): string[] {
    return [...descendants(root)].map(ownText).filter(Boolean);
}

/* -------------------------------------------------------------------------- */
/* Os tokens do globals.css e o contraste do WCAG                              */
/* -------------------------------------------------------------------------- */

type Rgb = readonly [number, number, number];

const CSS = readFileSync('src/app/globals.css', 'utf8');

/** `text-muted-fg` → `--muted-fg`: o bloco `@theme inline` expõe os tokens como utilitários. */
const UTILITIES = new Map(
    [...CSS.matchAll(/--color-([\w-]+):\s*var\(--([\w-]+)\)/g)].map(([, utility, variable]) => [utility!, variable!]),
);

const OKLCH_VARIABLE = /--([\w-]+):\s*oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)/g;

/** As cores de um tema (`:root` ou `.dark`) em sRGB, pelo nome do utilitário. */
function themeColors(selector: string): Map<string, Rgb> {
    const block = new RegExp(String.raw`^${selector}\s*\{([^}]*)\}`, 'm').exec(CSS)?.[1] ?? '';
    const variables = new Map<string, Rgb>();
    const colors = new Map<string, Rgb>();

    for (const [, name, lightness, chroma, hue] of block.matchAll(OKLCH_VARIABLE)) {
        variables.set(name!, oklchToSrgb(Number(lightness) / 100, Number(chroma), Number(hue)));
    }

    for (const [utility, variable] of UTILITIES) {
        const color = variables.get(variable);

        if (color) colors.set(utility, color);
    }

    return colors;
}

/** OKLCH → sRGB (0–1, com a curva de gama), cortando o que sai da gama. */
function oklchToSrgb(lightness: number, chroma: number, hue: number): Rgb {
    const a = chroma * Math.cos((hue * Math.PI) / 180);
    const b = chroma * Math.sin((hue * Math.PI) / 180);
    const long = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const medium = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const short = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;

    return [
        gamma(4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short),
        gamma(-1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short),
        gamma(-0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short),
    ];
}

function gamma(linear: number): number {
    const value = Math.min(1, Math.max(0, linear));

    return value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
}

/** Luminância relativa do WCAG 2. */
function luminance([r, g, b]: Rgb): number {
    const linear = (value: number) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);

    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(a: Rgb, b: Rgb): number {
    const [la, lb] = [luminance(a), luminance(b)];

    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** `color` com opacidade `alpha` sobre `backdrop`: a mistura que o navegador faz, no sRGB com gama. */
function over(color: Rgb, alpha: number, backdrop: Rgb): Rgb {
    const mix = (channel: 0 | 1 | 2) => color[channel] * alpha + backdrop[channel] * (1 - alpha);

    return [mix(0), mix(1), mix(2)];
}

interface Paint {
    color: Rgb;
    alpha: number;
}

/**
 * A cor de texto ou de fundo que o PRÓPRIO elemento declara: classe sem
 * variante (`hover:`, `[&>svg]:`...) com um token do tema, e a opacidade do
 * modificador (`bg-danger/12`). `text-xs` e afins não são cor e ficam de fora.
 */
function paintOf(el: El, property: 'text' | 'bg', colors: Map<string, Rgb>): Paint | null {
    for (const name of el.classes) {
        const match = /^(text|bg)-([\w-]+?)(?:\/(\d+))?$/.exec(name);
        const color = match?.[1] === property ? colors.get(match[2]!) : undefined;

        if (match && color) return { color, alpha: match[3] ? Number(match[3]) / 100 : 1 };
    }

    return null;
}

function opacityOf(el: El): number {
    const value = el.classes.map((name) => /^opacity-(\d+)$/.exec(name)?.[1]).find((match) => match !== undefined);

    return value === undefined ? 1 : Number(value) / 100;
}

function token(colors: Map<string, Rgb>, name: string): Rgb {
    const color = colors.get(name);

    if (!color) throw new Error(`O token "${name}" sumiu do globals.css.`);

    return color;
}

/**
 * O contraste do texto de `el` contra o que está atrás dele: a cor herdada do
 * ancestral mais próximo que declara uma (sem nenhuma, o `foreground` do body),
 * esmaecida pelos `opacity-*` do caminho, sobre as camadas de fundo empilhadas
 * até a primeira opaca — sem nenhuma, o `bg-surface` dos cartões do painel,
 * onde moram os selos e o histórico.
 */
function textContrast(el: El, colors: Map<string, Rgb>): number {
    const chain = lineage(el);
    const text = chain.map((node) => paintOf(node, 'text', colors)).find((paint) => paint !== null)?.color;
    const opacity = chain.reduce((product, node) => product * opacityOf(node), 1);
    const layers: Paint[] = [];

    for (const node of chain) {
        const background = paintOf(node, 'bg', colors);

        if (!background) continue;

        layers.push(background);

        if (background.alpha === 1) break;
    }

    const backdrop = layers.reduceRight(
        (under, layer) => over(layer.color, layer.alpha, under),
        token(colors, 'surface'),
    );

    return contrast(over(text ?? token(colors, 'foreground'), opacity, backdrop), backdrop);
}

/** Texto pequeno (até 18 px, ou 14 px em negrito) pede 4,5:1. */
const AA = 4.5;

/** Todo texto visível abaixo do mínimo, como "Bloqueado — 3.97:1". */
function belowAA(root: El, colors: Map<string, Rgb>): string[] {
    return [...descendants(root)]
        .filter((el) => ownText(el) !== '' && !lineage(el).some((node) => node.classes.includes('sr-only')))
        .map((el) => ({ text: ownText(el), ratio: textContrast(el, colors) }))
        .filter(({ ratio }) => ratio < AA)
        .map(({ text, ratio }) => `${text} — ${ratio.toFixed(2)}:1`);
}

const THEMES = [
    { name: 'claro', colors: themeColors(':root') },
    { name: 'escuro', colors: themeColors(String.raw`\.dark`) },
];

/* -------------------------------------------------------------------------- */

describe('histórico de administração: e-mail comprido não esconde o horário', () => {
    it('só o e-mail encolhe e corta; o horário fica fora da caixa que corta, e não encolhe', () => {
        const page = render(createElement(AdminHistory, { events: [event()] }));
        const time = [...descendants(page)].find((el) => el.tag === 'time');

        expect(time).toBeDefined();

        // `truncate` corta tudo o que passa da largura, e o horário vinha por último.
        expect(
            lineage(time!)
                .filter((el) => el.classes.includes('truncate'))
                .map((el) => el.classes.join(' ')),
        ).toEqual([]);

        const email = [...descendants(page)].find((el) => ownText(el) === LONG_EMAIL);

        expect(email).toBeDefined();

        // Os dois lado a lado numa linha flex: o e-mail cede a largura (e corta,
        // em vez de empurrar o cartão para fora da tela); o horário, nunca.
        const row = lineage(email!).find((el) => lineage(time!).includes(el))!;
        const itemOf = (el: El) => lineage(el).find((node) => node.parent === row)!;

        expect(row.classes).toContain('flex');
        expect(itemOf(email!).classes).toEqual(expect.arrayContaining(['min-w-0', 'truncate']));
        expect(itemOf(time!).classes).toContain('shrink-0');
    });
});

describe.each(THEMES)('contraste no tema $name (WCAG AA, 4,5:1)', ({ colors }) => {
    it('o cálculo confere: os tokens foram lidos e preto sobre branco dá 21:1', () => {
        expect([...colors.keys()]).toEqual(
            expect.arrayContaining(['foreground', 'surface', 'primary', 'primary-soft', 'danger']),
        );
        expect(contrast([0, 0, 0], [1, 1, 1])).toBeCloseTo(21, 5);
    });

    it('os selos da lista de contas', () => {
        const page = render(
            createElement(
                'div',
                null,
                createElement(AccountBadges, { row: account({ role: 'native' }), isViewer: true }),
                createElement(AccountBadges, {
                    row: account({ role: 'admin', blocked_at: NOW, blocked_by: 'Victor Gabriel' }),
                    isViewer: false,
                }),
                createElement(AccountBadges, { row: account({ role: 'native_pending' }), isViewer: false }),
            ),
        );

        // Os selos estão todos ali — sem eles, a conta abaixo passaria por não ter o que medir.
        expect(texts(page)).toEqual(
            expect.arrayContaining(['Você', 'Admin nativo', 'Admin', 'Aguardando confirmação', 'Bloqueado']),
        );
        expect(belowAA(page, colors)).toEqual([]);
    });

    it('o histórico, inclusive a linha do e-mail e do horário', () => {
        const page = render(
            createElement(AdminHistory, {
                events: [
                    event(),
                    event({ id: 2, type: 'admin.granted' }),
                    event({ id: 3, type: 'admin.activated', actor: null }),
                ],
            }),
        );

        expect(texts(page).some((text) => text.includes(LONG_EMAIL))).toBe(true);
        expect(belowAA(page, colors)).toEqual([]);
    });

    it.each(['native', 'admin'] as const)('o selo do cabeçalho do painel (%s)', (access) => {
        const page = render(createElement(AdminPanel, panel(access)));
        const title = [...descendants(page)].find((el) => el.tag === 'h1' && ownText(el) === 'Administração');
        const header = title && lineage(title).find((el) => el.tag === 'header');

        expect(header).toBeDefined();
        expect(texts(header!)).toContain(access === 'native' ? 'Admin nativo' : 'Admin');
        expect(belowAA(header!, colors)).toEqual([]);
    });
});
