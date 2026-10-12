import type { Board, BoardList, Card, CardExportDetail } from '@/types';
import { pluralize } from '@/lib/utils';

/**
 * Transforma cards selecionados em texto separado por sprints — a saída é
 * feita para ser colada num prompt, não para ser lida de volta pelo app.
 *
 * Tudo aqui é função pura: entra a seleção, saem sprints e uma string. O
 * componente cuida só do estado e dos botões.
 */

export type SprintMode = 'list' | 'due' | 'chunk' | 'manual';

export type ExportFormat = 'markdown' | 'text' | 'json';

export interface ExportOptions {
    format: ExportFormat;
    mode: SprintMode;
    /** Tarefas por sprint no modo "tamanho fixo". */
    chunkSize: number;
    /** Semanas que cabem numa sprint no modo "por prazo". */
    weeks: number;
    instructions: string;
    includeInstructions: boolean;
    includeBoard: boolean;
    includeList: boolean;
    includeDue: boolean;
    includeLabels: boolean;
    includeMembers: boolean;
    includeDescription: boolean;
    includeChecklists: boolean;
    includeComments: boolean;
}

/** Sprints montadas na mão: nome de cada uma e em qual delas cada card caiu. */
export interface ManualSprints {
    names: string[];
    assignment: Record<number, number>;
}

export interface SprintTask {
    card: Card;
    listTitle: string;
    /** Ausente enquanto a prop `exportDetails` não chegou do servidor. */
    detail: CardExportDetail | null;
}

export interface Sprint {
    id: string;
    name: string;
    tasks: SprintTask[];
}

export const DEFAULT_INSTRUCTIONS =
    'Você é um tech lead. Abaixo está o backlog de um quadro, já separado em sprints.\n' +
    'Para cada sprint: revise o escopo, aponte dependências entre as tarefas, estime o esforço\n' +
    'e liste os riscos. Se alguma tarefa estiver mal descrita, diga o que falta.';

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
    format: 'markdown',
    mode: 'list',
    chunkSize: 5,
    weeks: 1,
    instructions: DEFAULT_INSTRUCTIONS,
    includeInstructions: true,
    includeBoard: true,
    includeList: true,
    includeDue: true,
    includeLabels: true,
    includeMembers: true,
    includeDescription: true,
    includeChecklists: true,
    includeComments: false,
};

export const SPRINT_MODE_LABEL: Record<SprintMode, string> = {
    list: 'Por lista',
    due: 'Por prazo',
    chunk: 'Tamanho fixo',
    manual: 'Manual',
};

export const FORMAT_LABEL: Record<ExportFormat, string> = {
    markdown: 'Markdown',
    text: 'Texto',
    json: 'JSON',
};

const FORMAT_EXTENSION: Record<ExportFormat, string> = {
    markdown: 'md',
    text: 'txt',
    json: 'json',
};

export const FORMAT_MIME: Record<ExportFormat, string> = {
    markdown: 'text/markdown;charset=utf-8',
    text: 'text/plain;charset=utf-8',
    json: 'application/json;charset=utf-8',
};

/**
 * A data do texto exportado leva o ano; a da interface não. O `formatDate` de
 * `lib/utils` corta o ano porque ali o contexto é o quadro aberto agora — o
 * texto é lido fora do app, meses depois, por quem não tem a tela do lado.
 */
const exportDateFormatter = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
});

function formatExportDate(iso: string | null | undefined): string {
    return iso ? exportDateFormatter.format(new Date(iso)) : '';
}

const DAY_MS = 86_400_000;

function addDays(date: Date, days: number): Date {
    const result = new Date(date);

    result.setDate(result.getDate() + days);

    return result;
}

/** Segunda-feira da semana da data, à meia-noite. */
function startOfWeek(date: Date): Date {
    const result = new Date(date);

    result.setHours(0, 0, 0, 0);

    // getDay(): 0 = domingo. A sprint começa na segunda, como a semana de trabalho.
    return addDays(result, -((result.getDay() + 6) % 7));
}

/* -------------------------------------------------------------------------- */
/* Coleta e agrupamento                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Os cards selecionados na ordem em que aparecem no quadro — coluna por
 * coluna, de cima para baixo. É a ordem que a pessoa vê, então é a que o texto
 * precisa manter.
 */
export function collectTasks(
    lists: BoardList[],
    selected: Set<number>,
    details: Map<number, CardExportDetail>,
): SprintTask[] {
    return lists.flatMap((list) =>
        list.cards
            .filter((card) => selected.has(card.id))
            .map((card) => ({ card, listTitle: list.title, detail: details.get(card.id) ?? null })),
    );
}

export function buildSprints(tasks: SprintTask[], options: ExportOptions, manual: ManualSprints): Sprint[] {
    switch (options.mode) {
        case 'list':
            return byList(tasks);
        case 'due':
            return byDue(tasks, Math.max(1, Math.round(options.weeks)));
        case 'chunk':
            return byChunk(tasks, Math.max(1, Math.round(options.chunkSize)));
        case 'manual':
            return byManual(tasks, manual);
    }
}

function byList(tasks: SprintTask[]): Sprint[] {
    const groups = new Map<number, Sprint>();

    tasks.forEach((task) => {
        const id = task.card.board_list_id;
        const sprint = groups.get(id) ?? { id: `list-${id}`, name: task.listTitle, tasks: [] };

        sprint.tasks.push(task);
        groups.set(id, sprint);
    });

    return [...groups.values()];
}

/**
 * Janelas de N semanas ancoradas na primeira tarefa de cada janela — não numa
 * grade fixa desde a data mais antiga. Assim um backlog com prazos esparsos não
 * gera doze sprints vazias entre uma tarefa e outra.
 */
function byDue(tasks: SprintTask[], weeks: number): Sprint[] {
    const dated = tasks
        .filter((task) => task.card.due_at)
        .sort((a, b) => Date.parse(a.card.due_at!) - Date.parse(b.card.due_at!));

    const undated = tasks.filter((task) => !task.card.due_at);
    const windows: { start: Date; end: Date; tasks: SprintTask[] }[] = [];

    dated.forEach((task) => {
        const due = new Date(task.card.due_at!);
        const current = windows.at(-1);

        if (current && due < current.end) {
            current.tasks.push(task);

            return;
        }

        const start = startOfWeek(due);

        windows.push({ start, end: addDays(start, 7 * weeks), tasks: [task] });
    });

    const sprints: Sprint[] = windows.map((window, index) => ({
        id: `due-${window.start.getTime()}`,
        name: `Sprint ${index + 1} — ${formatExportDate(window.start.toISOString())} a ${formatExportDate(
            new Date(window.end.getTime() - DAY_MS).toISOString(),
        )}`,
        tasks: window.tasks,
    }));

    if (undated.length > 0) {
        sprints.push({ id: 'due-none', name: 'Sem prazo', tasks: undated });
    }

    return sprints;
}

function byChunk(tasks: SprintTask[], size: number): Sprint[] {
    const sprints: Sprint[] = [];

    for (let index = 0; index < tasks.length; index += size) {
        sprints.push({
            id: `chunk-${index}`,
            name: `Sprint ${sprints.length + 1}`,
            tasks: tasks.slice(index, index + size),
        });
    }

    return sprints;
}

/**
 * No manual as sprints vazias sobrevivem: elas são o alvo para onde arrastar a
 * próxima tarefa. Quem some com elas é o renderizador, na hora de escrever.
 */
function byManual(tasks: SprintTask[], manual: ManualSprints): Sprint[] {
    const names = manual.names.length > 0 ? manual.names : ['Sprint 1'];
    const sprints: Sprint[] = names.map((name, index) => ({ id: `manual-${index}`, name, tasks: [] }));

    tasks.forEach((task) => {
        const index = manual.assignment[task.card.id] ?? 0;

        sprints[Math.min(Math.max(index, 0), sprints.length - 1)].tasks.push(task);
    });

    return sprints;
}

/* -------------------------------------------------------------------------- */
/* Renderização                                                                */
/* -------------------------------------------------------------------------- */

export function renderExport(sprints: Sprint[], board: Board, options: ExportOptions): string {
    const filled = sprints.filter((sprint) => sprint.tasks.length > 0);

    if (options.format === 'json') return renderJson(filled, board, options);

    return options.format === 'text' ? renderText(filled, board, options) : renderMarkdown(filled, board, options);
}

/**
 * Etiqueta sem nome existe (a cor sozinha diz algo no quadro), mas em texto
 * corrido ela não diz nada — vira ruído no prompt. Fica de fora.
 */
function labelNames(card: Card, board: Board): string[] {
    return board.labels.flatMap((label) =>
        card.label_ids.includes(label.id) && label.name ? [label.name] : [],
    );
}

function memberNames(card: Card, board: Board): string[] {
    return board.members.filter((member) => card.member_ids.includes(member.id)).map((member) => member.name);
}

/**
 * As linhas de contexto da tarefa. A lista fica de fora quando as sprints já
 * SÃO as listas: repetir "Lista: A fazer" embaixo de "Sprint: A fazer" só
 * gasta contexto do modelo.
 */
function metaLines(task: SprintTask, board: Board, options: ExportOptions): string[] {
    const lines: string[] = [];
    const labels = labelNames(task.card, board);
    const members = memberNames(task.card, board);

    if (options.includeList && options.mode !== 'list') lines.push(`Lista: ${task.listTitle}`);
    if (task.card.completed_at) lines.push(`Status: concluída em ${formatExportDate(task.card.completed_at)}`);
    if (options.includeDue && task.card.due_at) lines.push(`Prazo: ${formatExportDate(task.card.due_at)}`);
    if (options.includeLabels && labels.length > 0) lines.push(`Etiquetas: ${labels.join(', ')}`);
    if (options.includeMembers && members.length > 0) lines.push(`Responsáveis: ${members.join(', ')}`);

    return lines;
}

function checklistHeading(checklist: { title: string; items: { is_done: boolean }[] }): string {
    const done = checklist.items.filter((item) => item.is_done).length;

    return `Checklist — ${checklist.title} (${done}/${checklist.items.length})`;
}

function commentLabel(comment: { author: string | null; created_at: string | null }): string {
    const date = formatExportDate(comment.created_at);

    return date ? `${comment.author ?? 'Alguém'} (${date})` : (comment.author ?? 'Alguém');
}

/** Recua as linhas seguintes de um texto multilinha, preservando a primeira. */
function hangingIndent(text: string, prefix: string): string {
    const [first, ...rest] = text.trim().split('\n');

    return [first, ...rest.map((line) => (line.trim() ? prefix + line.trim() : ''))].join('\n');
}

function indentBlock(text: string, prefix: string): string {
    return text
        .trim()
        .split('\n')
        .map((line) => (line.trim() ? prefix + line.trim() : ''))
        .join('\n');
}

function summary(sprints: Sprint[]): string {
    const total = sprints.reduce((count, sprint) => count + sprint.tasks.length, 0);

    return `${pluralize(total, 'tarefa', 'tarefas')} em ${pluralize(sprints.length, 'sprint', 'sprints')}.`;
}

function renderMarkdown(sprints: Sprint[], board: Board, options: ExportOptions): string {
    // Cada item vira um parágrafo: juntar com linha em branco no fim evita
    // espalhar '\n\n' por vinte concatenações.
    const blocks: string[] = [];

    if (options.includeInstructions && options.instructions.trim()) {
        blocks.push(options.instructions.trim(), '---');
    }

    if (options.includeBoard) {
        blocks.push(`# ${board.title}`);

        if (board.description) blocks.push(board.description.trim());
    }

    blocks.push(summary(sprints));

    sprints.forEach((sprint) => {
        blocks.push(`## ${sprint.name} (${pluralize(sprint.tasks.length, 'tarefa', 'tarefas')})`);

        sprint.tasks.forEach((task, index) => {
            blocks.push(`### ${index + 1}. ${task.card.title}`);

            const meta = metaLines(task, board, options);

            if (meta.length > 0) blocks.push(meta.map((line) => `- ${line}`).join('\n'));

            const description = task.detail?.description?.trim();

            if (options.includeDescription && description) {
                blocks.push('**Descrição**', description);
            }

            if (options.includeChecklists) {
                task.detail?.checklists.forEach((checklist) => {
                    if (checklist.items.length === 0) return;

                    blocks.push(
                        `**${checklistHeading(checklist)}**`,
                        checklist.items
                            .map((item) => `- [${item.is_done ? 'x' : ' '}] ${item.content}`)
                            .join('\n'),
                    );
                });
            }

            if (options.includeComments && task.detail && task.detail.comments.length > 0) {
                blocks.push(
                    '**Comentários**',
                    task.detail.comments
                        .map((comment) => `- ${commentLabel(comment)}: ${hangingIndent(comment.body, '  ')}`)
                        .join('\n'),
                );
            }
        });
    });

    return `${blocks.join('\n\n')}\n`;
}

function renderText(sprints: Sprint[], board: Board, options: ExportOptions): string {
    const body = '   ';
    const blocks: string[] = [];

    if (options.includeInstructions && options.instructions.trim()) {
        blocks.push(options.instructions.trim(), '='.repeat(60));
    }

    if (options.includeBoard) {
        blocks.push(board.title.toUpperCase());

        if (board.description) blocks.push(board.description.trim());
    }

    blocks.push(summary(sprints));

    sprints.forEach((sprint) => {
        const heading = `${sprint.name.toUpperCase()} (${pluralize(sprint.tasks.length, 'tarefa', 'tarefas')})`;

        blocks.push(`${heading}\n${'-'.repeat(heading.length)}`);

        sprint.tasks.forEach((task, index) => {
            const lines = [`${index + 1}. ${task.card.title}`];

            metaLines(task, board, options).forEach((line) => lines.push(body + line));

            const description = task.detail?.description?.trim();

            if (options.includeDescription && description) {
                lines.push(`${body}Descrição:`, indentBlock(description, body + body));
            }

            if (options.includeChecklists) {
                task.detail?.checklists.forEach((checklist) => {
                    if (checklist.items.length === 0) return;

                    lines.push(`${body}${checklistHeading(checklist)}:`);
                    checklist.items.forEach((item) =>
                        lines.push(`${body}${body}[${item.is_done ? 'x' : ' '}] ${item.content}`),
                    );
                });
            }

            if (options.includeComments && task.detail && task.detail.comments.length > 0) {
                lines.push(`${body}Comentários:`);
                task.detail.comments.forEach((comment) =>
                    lines.push(
                        `${body}${body}- ${commentLabel(comment)}: ${hangingIndent(comment.body, body + body + '  ')}`,
                    ),
                );
            }

            blocks.push(lines.join('\n'));
        });
    });

    return `${blocks.join('\n\n')}\n`;
}

/**
 * As chaves saem em português de propósito: o prompt inteiro está em
 * português, e um JSON com `title`/`due` no meio faz o modelo alternar de
 * idioma na resposta.
 */
function renderJson(sprints: Sprint[], board: Board, options: ExportOptions): string {
    const payload = {
        instrucoes: options.includeInstructions && options.instructions.trim() ? options.instructions.trim() : undefined,
        quadro: options.includeBoard ? { titulo: board.title, descricao: board.description } : undefined,
        total_de_tarefas: sprints.reduce((count, sprint) => count + sprint.tasks.length, 0),
        sprints: sprints.map((sprint) => ({
            nome: sprint.name,
            tarefas: sprint.tasks.map((task) => ({
                titulo: task.card.title,
                lista: options.includeList && options.mode !== 'list' ? task.listTitle : undefined,
                concluida: task.card.completed_at !== null,
                prazo: options.includeDue ? (task.card.due_at?.slice(0, 10) ?? null) : undefined,
                etiquetas: options.includeLabels ? labelNames(task.card, board) : undefined,
                responsaveis: options.includeMembers ? memberNames(task.card, board) : undefined,
                descricao: options.includeDescription ? (task.detail?.description ?? null) : undefined,
                checklists: options.includeChecklists
                    ? task.detail?.checklists.map((checklist) => ({
                          titulo: checklist.title,
                          itens: checklist.items.map((item) => ({ item: item.content, feito: item.is_done })),
                      }))
                    : undefined,
                comentarios: options.includeComments
                    ? task.detail?.comments.map((comment) => ({
                          autor: comment.author,
                          data: comment.created_at,
                          texto: comment.body,
                      }))
                    : undefined,
            })),
        })),
    };

    return `${JSON.stringify(payload, null, 2)}\n`;
}

/* -------------------------------------------------------------------------- */
/* Arquivo                                                                     */
/* -------------------------------------------------------------------------- */

export function exportFileName(board: Board, format: ExportFormat): string {
    const slug =
        board.title
            .normalize('NFD')
            .replace(/\p{Diacritic}/gu, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '') || 'quadro';

    return `${slug}-sprints-${new Date().toISOString().slice(0, 10)}.${FORMAT_EXTENSION[format]}`;
}
