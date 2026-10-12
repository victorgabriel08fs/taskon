'use client';

import { ClipboardCopy, Download, Loader2, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { runAction } from '@/lib/actions';
import {
    DEFAULT_EXPORT_OPTIONS,
    DEFAULT_INSTRUCTIONS,
    FORMAT_LABEL,
    FORMAT_MIME,
    SPRINT_MODE_LABEL,
    buildSprints,
    collectTasks,
    exportFileName,
    renderExport,
    type ExportFormat,
    type ExportOptions,
    type ManualSprints,
    type SprintMode,
} from '@/lib/task-export';
import { cn, pluralize } from '@/lib/utils';
import { loadExportDetails } from '@/server/actions/export';
import type { Board, CardExportDetail } from '@/types';

interface ExportModalProps {
    open: boolean;
    board: Board;
    selected: Set<number>;
    onToggleCard: (cardId: number) => void;
    onClose: () => void;
}

const STORAGE_KEY = 'taskon:export';

const MODES = Object.entries(SPRINT_MODE_LABEL) as [SprintMode, string][];
const FORMATS = Object.entries(FORMAT_LABEL) as [ExportFormat, string][];

/*
 * As opções sobrevivem ao fechar do modal: montar o prompt é uma tarefa
 * repetida, e reconfigurar tudo a cada exportação seria trabalho jogado fora.
 *
 * Elas moram no localStorage, lido por `useSyncExternalStore`: no servidor (e
 * na hidratação) vale o padrão, e o que a pessoa escolheu entra logo depois —
 * sem o HTML do SSR divergir do primeiro render do navegador.
 */
const optionListeners = new Set<() => void>();

/** O que o navegador não deixou gravar: vale até a aba fechar. */
let unsavedOptions: string | null = null;

function subscribeOptions(listener: () => void): () => void {
    optionListeners.add(listener);

    return () => optionListeners.delete(listener);
}

function storedOptions(): string | null {
    if (unsavedOptions !== null) return unsavedOptions;

    try {
        return window.localStorage.getItem(STORAGE_KEY);
    } catch {
        return null;
    }
}

function saveOptions(options: ExportOptions): void {
    const raw = JSON.stringify(options);

    try {
        window.localStorage.setItem(STORAGE_KEY, raw);
        unsavedOptions = null;
    } catch {
        // Aba anônima ou cota cheia: as opções valem só para esta sessão.
        unsavedOptions = raw;
    }

    optionListeners.forEach((listener) => listener());
}

function parseOptions(raw: string | null): ExportOptions {
    if (!raw) return DEFAULT_EXPORT_OPTIONS;

    try {
        return { ...DEFAULT_EXPORT_OPTIONS, ...(JSON.parse(raw) as Partial<ExportOptions>) };
    } catch {
        return DEFAULT_EXPORT_OPTIONS;
    }
}

export function ExportModal({ open, board, selected, onToggleCard, onClose }: ExportModalProps) {
    const stored = useSyncExternalStore(subscribeOptions, storedOptions, () => null);
    const options = useMemo(() => parseOptions(stored), [stored]);
    const [manual, setManual] = useState<ManualSprints>({ names: ['Sprint 1'], assignment: {} });
    const [tab, setTab] = useState<'preview' | 'sprints'>('preview');

    /** Descrição, checklists e comentários de todos os cards vivos, casados pelo `id`. */
    const [loaded, setLoaded] = useState<{ boardId: number; details: CardExportDetail[] } | null>(null);
    const requested = useRef<number | null>(null);

    // Os detalhes são a parte pesada (descrição, checklist e comentário de
    // TODOS os cards) e o Kanban nunca os carrega: só são lidos quando alguém
    // abre a exportação. Uma vez recebidos, ficam — o pedido é único por
    // visita ao quadro, como era a prop `optional` do Inertia.
    useEffect(() => {
        if (!open || requested.current === board.id) return;

        const boardId = board.id;

        requested.current = boardId;

        void runAction(loadExportDetails({ boardId }), {
            onSuccess: (details) => setLoaded({ boardId, details }),
        }).then((result) => {
            // Falhou (rede, deploy novo): a próxima abertura pede de novo.
            if (!result?.ok && requested.current === boardId) requested.current = null;
        });
    }, [open, board.id]);

    /** Ausente enquanto os detalhes não chegaram do servidor. */
    const details = loaded?.boardId === board.id ? loaded.details : undefined;

    const detailMap = useMemo(() => new Map((details ?? []).map((detail) => [detail.id, detail])), [details]);
    const tasks = useMemo(() => collectTasks(board.lists, selected, detailMap), [board.lists, selected, detailMap]);
    const sprints = useMemo(() => buildSprints(tasks, options, manual), [tasks, options, manual]);
    const text = useMemo(() => renderExport(sprints, board, options), [sprints, board, options]);

    const filled = sprints.filter((sprint) => sprint.tasks.length > 0);

    const set = <K extends keyof ExportOptions>(key: K, value: ExportOptions[K]) =>
        saveOptions({ ...options, [key]: value });

    const changeMode = (mode: SprintMode) => {
        if (mode === 'manual') {
            // Entrar no manual não joga fora o agrupamento anterior: ele vira o
            // ponto de partida, e a pessoa só move o que ficou fora do lugar.
            setManual({
                names: sprints.length > 0 ? sprints.map((sprint) => sprint.name) : ['Sprint 1'],
                assignment: Object.fromEntries(
                    sprints.flatMap((sprint, index) => sprint.tasks.map((task) => [task.card.id, index] as const)),
                ),
            });
            setTab('sprints');
        }

        set('mode', mode);
    };

    const renameSprint = (index: number, name: string) =>
        setManual((current) => ({ ...current, names: current.names.map((item, i) => (i === index ? name : item)) }));

    const addSprint = () =>
        setManual((current) => ({ ...current, names: [...current.names, `Sprint ${current.names.length + 1}`] }));

    const removeSprint = (index: number) =>
        setManual((current) => {
            if (current.names.length <= 1) return current;

            const assignment: Record<number, number> = {};

            // Quem estava na sprint apagada cai na anterior; quem estava depois
            // dela sobe uma posição — sem isso as tarefas iriam todas para a
            // primeira sprint a cada remoção.
            Object.entries(current.assignment).forEach(([id, sprint]) => {
                assignment[Number(id)] = sprint === index ? Math.max(0, index - 1) : sprint > index ? sprint - 1 : sprint;
            });

            return { names: current.names.filter((_, i) => i !== index), assignment };
        });

    const assign = (cardId: number, sprint: number) =>
        setManual((current) => ({ ...current, assignment: { ...current.assignment, [cardId]: sprint } }));

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(text);
            toast.success('Prompt copiado.');
        } catch {
            toast.error('O navegador bloqueou a cópia. Selecione o texto da prévia e copie na mão.');
        }
    };

    const download = () => {
        const url = URL.createObjectURL(new Blob([text], { type: FORMAT_MIME[options.format] }));
        const link = document.createElement('a');

        link.href = url;
        link.download = exportFileName(board, options.format);
        link.click();
        URL.revokeObjectURL(url);
    };

    return (
        <Modal open={open} onClose={onClose} className="max-w-5xl" hideClose labelledBy="export-title">
            <div className="flex max-h-[86vh] flex-col">
                <header className="flex items-start gap-3 border-b border-border px-5 py-4">
                    <div className="min-w-0 flex-1">
                        <h2 id="export-title" className="text-lg font-bold">
                            Exportar como prompt
                        </h2>
                        <p className="mt-0.5 text-xs text-muted-fg">
                            {pluralize(tasks.length, 'tarefa selecionada', 'tarefas selecionadas')} ·{' '}
                            {pluralize(filled.length, 'sprint', 'sprints')} · {text.length.toLocaleString('pt-BR')}{' '}
                            caracteres
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Fechar"
                        className="shrink-0 rounded-lg p-1.5 text-muted-fg transition-colors hover:bg-surface-2 hover:text-foreground"
                    >
                        <X className="size-4.5" />
                    </button>
                </header>

                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:grid md:grid-cols-[17rem_1fr] md:overflow-hidden">
                    {/* ------------------------------------------------------- opções */}
                    <aside className="shrink-0 space-y-5 border-b border-border p-4 md:min-h-0 md:overflow-y-auto md:border-b-0 md:border-r">
                        <Field label="Separar em sprints">
                            <Segmented
                                options={MODES}
                                value={options.mode}
                                onChange={changeMode}
                                ariaLabel="Modo de agrupamento"
                            />

                            {options.mode === 'chunk' && (
                                <NumberField
                                    label="Tarefas por sprint"
                                    value={options.chunkSize}
                                    min={1}
                                    max={50}
                                    onChange={(value) => set('chunkSize', value)}
                                />
                            )}

                            {options.mode === 'due' && (
                                <NumberField
                                    label="Semanas por sprint"
                                    value={options.weeks}
                                    min={1}
                                    max={8}
                                    onChange={(value) => set('weeks', value)}
                                />
                            )}
                        </Field>

                        <Field label="Formato">
                            <Segmented
                                options={FORMATS}
                                value={options.format}
                                onChange={(value) => set('format', value)}
                                ariaLabel="Formato do texto"
                            />
                        </Field>

                        <Field label="Incluir em cada tarefa">
                            <div className="space-y-0.5">
                                <Check label="Prazo" checked={options.includeDue} onChange={(v) => set('includeDue', v)} />
                                <Check
                                    label="Etiquetas"
                                    checked={options.includeLabels}
                                    onChange={(v) => set('includeLabels', v)}
                                />
                                <Check
                                    label="Responsáveis"
                                    checked={options.includeMembers}
                                    onChange={(v) => set('includeMembers', v)}
                                />
                                {/* Com as sprints saindo das listas, dizer a lista de
                                    origem em cada tarefa só repetiria o título da sprint. */}
                                {options.mode !== 'list' && (
                                    <Check
                                        label="Lista de origem"
                                        checked={options.includeList}
                                        onChange={(v) => set('includeList', v)}
                                    />
                                )}
                                <Check
                                    label="Descrição"
                                    checked={options.includeDescription}
                                    onChange={(v) => set('includeDescription', v)}
                                />
                                <Check
                                    label="Checklists"
                                    checked={options.includeChecklists}
                                    onChange={(v) => set('includeChecklists', v)}
                                />
                                <Check
                                    label="Comentários"
                                    checked={options.includeComments}
                                    onChange={(v) => set('includeComments', v)}
                                />
                                <Check
                                    label="Nome e descrição do quadro"
                                    checked={options.includeBoard}
                                    onChange={(v) => set('includeBoard', v)}
                                />
                            </div>
                        </Field>

                        <Field label="Instrução no topo">
                            <Check
                                label="Abrir o texto com uma instrução"
                                checked={options.includeInstructions}
                                onChange={(v) => set('includeInstructions', v)}
                            />

                            {options.includeInstructions && (
                                <>
                                    <textarea
                                        rows={5}
                                        value={options.instructions}
                                        onChange={(event) => set('instructions', event.target.value)}
                                        aria-label="Instrução do prompt"
                                        className="w-full resize-y rounded-lg bg-surface-2 px-2.5 py-2 text-xs leading-relaxed ring-1 ring-border focus:outline-none focus:ring-2 focus:ring-primary"
                                    />

                                    {options.instructions !== DEFAULT_INSTRUCTIONS && (
                                        <button
                                            type="button"
                                            onClick={() => set('instructions', DEFAULT_INSTRUCTIONS)}
                                            className="inline-flex items-center gap-1.5 text-xs text-muted-fg transition-colors hover:text-foreground"
                                        >
                                            <RotateCcw className="size-3" />
                                            Restaurar o texto padrão
                                        </button>
                                    )}
                                </>
                            )}
                        </Field>
                    </aside>

                    {/* -------------------------------------------------- prévia/sprints */}
                    <section className="flex min-h-0 flex-1 flex-col">
                        <div className="flex items-center gap-1 border-b border-border px-4 pt-3">
                            <Tab active={tab === 'preview'} onClick={() => setTab('preview')}>
                                Prévia
                            </Tab>
                            <Tab active={tab === 'sprints'} onClick={() => setTab('sprints')}>
                                Sprints ({sprints.length})
                            </Tab>

                            {details === undefined && (
                                <span className="ml-auto inline-flex items-center gap-1.5 pb-2 text-[11px] text-muted-fg">
                                    <Loader2 className="size-3 animate-spin" />
                                    carregando descrições…
                                </span>
                            )}
                        </div>

                        {tasks.length === 0 ? (
                            <p className="m-4 rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-fg">
                                Nenhuma tarefa selecionada. Feche e marque os cards que devem entrar no prompt.
                            </p>
                        ) : tab === 'preview' ? (
                            <pre className="min-h-0 max-h-[50vh] flex-1 overflow-auto whitespace-pre-wrap break-words bg-surface-2/50 p-4 font-mono text-xs leading-relaxed text-foreground md:max-h-none">
                                {text}
                            </pre>
                        ) : (
                            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                                {sprints.map((sprint, index) => (
                                    <div key={sprint.id} className="rounded-xl bg-surface-2/50 p-3 ring-1 ring-border">
                                        <div className="flex items-center gap-2">
                                            {options.mode === 'manual' ? (
                                                <input
                                                    value={sprint.name}
                                                    onChange={(event) => renameSprint(index, event.target.value)}
                                                    aria-label={`Nome da sprint ${index + 1}`}
                                                    className="min-w-0 flex-1 rounded-md bg-surface px-2 py-1 text-sm font-semibold ring-1 ring-border focus:outline-none focus:ring-2 focus:ring-primary"
                                                />
                                            ) : (
                                                <p className="min-w-0 flex-1 truncate text-sm font-semibold">
                                                    {sprint.name}
                                                </p>
                                            )}

                                            <span className="shrink-0 text-[11px] tabular-nums text-muted-fg">
                                                {pluralize(sprint.tasks.length, 'tarefa', 'tarefas')}
                                            </span>

                                            {options.mode === 'manual' && sprints.length > 1 && (
                                                <button
                                                    type="button"
                                                    onClick={() => removeSprint(index)}
                                                    aria-label={`Remover a sprint ${sprint.name}`}
                                                    className="shrink-0 rounded-md p-1 text-muted-fg transition-colors hover:bg-danger/10 hover:text-danger"
                                                >
                                                    <Trash2 className="size-3.5" />
                                                </button>
                                            )}
                                        </div>

                                        <ul className="mt-2 space-y-1">
                                            {sprint.tasks.map((task) => (
                                                <li
                                                    key={task.card.id}
                                                    className="flex items-center gap-2 rounded-lg bg-surface px-2.5 py-1.5 ring-1 ring-border"
                                                >
                                                    <span className="min-w-0 flex-1 truncate text-sm">
                                                        {task.card.title}
                                                    </span>

                                                    {options.mode === 'manual' && (
                                                        <select
                                                            value={manual.assignment[task.card.id] ?? 0}
                                                            onChange={(event) =>
                                                                assign(task.card.id, Number(event.target.value))
                                                            }
                                                            aria-label={`Sprint de ${task.card.title}`}
                                                            className="max-w-[9rem] shrink-0 rounded-md bg-surface-2 px-1.5 py-1 text-xs ring-1 ring-border focus:outline-none focus:ring-2 focus:ring-primary"
                                                        >
                                                            {sprints.map((option, optionIndex) => (
                                                                <option key={option.id} value={optionIndex}>
                                                                    {option.name}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    )}

                                                    <button
                                                        type="button"
                                                        onClick={() => onToggleCard(task.card.id)}
                                                        aria-label={`Tirar "${task.card.title}" da exportação`}
                                                        className="shrink-0 rounded-md p-1 text-muted-fg transition-colors hover:bg-danger/10 hover:text-danger"
                                                    >
                                                        <X className="size-3.5" />
                                                    </button>
                                                </li>
                                            ))}

                                            {sprint.tasks.length === 0 && (
                                                <li className="rounded-lg border border-dashed border-border px-2.5 py-3 text-center text-xs text-muted-fg">
                                                    Vazia — escolha esta sprint no seletor de alguma tarefa.
                                                </li>
                                            )}
                                        </ul>
                                    </div>
                                ))}

                                {options.mode === 'manual' && (
                                    <Button variant="secondary" size="sm" onClick={addSprint}>
                                        <Plus className="size-3.5" />
                                        Adicionar sprint
                                    </Button>
                                )}
                            </div>
                        )}
                    </section>
                </div>

                <footer className="flex items-center gap-2 border-t border-border px-5 py-3">
                    <p className="mr-auto hidden text-xs text-muted-fg sm:block">
                        O texto é montado no navegador — nada é enviado para fora.
                    </p>

                    <Button variant="secondary" onClick={download} disabled={tasks.length === 0}>
                        <Download className="size-4" />
                        Baixar
                    </Button>

                    <Button onClick={copy} disabled={tasks.length === 0}>
                        <ClipboardCopy className="size-4" />
                        Copiar
                    </Button>
                </footer>
            </div>
        </Modal>
    );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-fg">{label}</p>
            {children}
        </div>
    );
}

function Segmented<T extends string>({
    options,
    value,
    onChange,
    ariaLabel,
}: {
    options: [T, string][];
    value: T;
    onChange: (value: T) => void;
    ariaLabel: string;
}) {
    return (
        <div
            role="group"
            aria-label={ariaLabel}
            className={cn(
                'grid gap-1 rounded-lg bg-surface-2 p-1',
                options.length === 3 ? 'grid-cols-3' : 'grid-cols-2',
            )}
        >
            {options.map(([key, label]) => (
                <button
                    key={key}
                    type="button"
                    aria-pressed={value === key}
                    onClick={() => onChange(key)}
                    className={cn(
                        'rounded-md px-2 py-1.5 text-xs font-medium transition-colors duration-150',
                        value === key ? 'bg-surface text-foreground shadow-sm' : 'text-muted-fg hover:text-foreground',
                    )}
                >
                    {label}
                </button>
            ))}
        </div>
    );
}

function Check({
    label,
    checked,
    onChange,
}: {
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
}) {
    return (
        <button
            type="button"
            role="checkbox"
            aria-checked={checked}
            onClick={() => onChange(!checked)}
            className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left text-sm transition-colors hover:bg-surface-2"
        >
            <span
                className={cn(
                    'grid size-4 shrink-0 place-items-center rounded border transition-colors duration-150',
                    checked ? 'border-primary bg-primary text-primary-fg' : 'border-border bg-surface',
                )}
            >
                {checked && (
                    <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
                        <path
                            d="M2.5 6.2 4.8 8.5 9.5 3.8"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                    </svg>
                )}
            </span>
            {label}
        </button>
    );
}

function NumberField({
    label,
    value,
    min,
    max,
    onChange,
}: {
    label: string;
    value: number;
    min: number;
    max: number;
    onChange: (value: number) => void;
}) {
    return (
        <label className="flex items-center justify-between gap-2 rounded-lg px-1.5 py-1 text-sm">
            {label}
            <input
                type="number"
                min={min}
                max={max}
                value={value}
                onChange={(event) => onChange(Math.min(max, Math.max(min, event.target.valueAsNumber || min)))}
                className="w-16 rounded-md bg-surface-2 px-2 py-1 text-sm tabular-nums ring-1 ring-border focus:outline-none focus:ring-2 focus:ring-primary"
            />
        </label>
    );
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            className={cn(
                '-mb-px border-b-2 px-3 pb-2 text-sm font-medium transition-colors duration-150',
                active ? 'border-primary text-foreground' : 'border-transparent text-muted-fg hover:text-foreground',
            )}
        >
            {children}
        </button>
    );
}
