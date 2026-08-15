import { Link } from '@inertiajs/react';
import { Pause, Play, RotateCcw, Settings2, SkipForward, Timer, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Popover } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { usePomodoro } from '@/hooks/use-pomodoro';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import {
    claimPomodoro,
    clearPomodoroTask,
    clock,
    PHASE_LABEL,
    resetPomodoro,
    setPomodoroPhase,
    skipPomodoro,
    togglePomodoro,
    updatePomodoroSettings,
    type PomodoroPhase,
    type PomodoroSettings,
    type PomodoroSnapshot,
} from '@/lib/pomodoro';
import { cn, pluralize } from '@/lib/utils';

const PHASES: PomodoroPhase[] = ['focus', 'short', 'long'];

/** Foco puxa a cor da marca; pausa puxa o verde de "pode respirar". */
function accent(phase: PomodoroPhase): string {
    return phase === 'focus' ? 'var(--primary)' : 'var(--success)';
}

function fullOf(pomodoro: PomodoroSnapshot): number {
    return pomodoro.settings[pomodoro.phase] * 60_000;
}

/**
 * Cronômetro pomodoro do cabeçalho — visível em todo o app autenticado e,
 * portanto, em qualquer canto dos quadros.
 *
 * Mora no cabeçalho, e não flutuando num canto, por dois motivos concretos: o
 * canto inferior direito é do `Toaster` (ver app.tsx) e o resto da tela do
 * quadro é área de arraste das colunas.
 */
export function PomodoroWidget({ userId, overlay = false }: { userId: number; overlay?: boolean }) {
    const pomodoro = usePomodoro();

    // Trocou de conta na mesma máquina: o ciclo (e o card nele) é de outra
    // pessoa. Ver `claimPomodoro`.
    useEffect(() => claimPomodoro(userId), [userId]);

    const active = pomodoro.running || pomodoro.left < fullOf(pomodoro);

    return (
        <>
            {/* A região viva precisa existir ANTES da virada de fase: criada já
                preenchida (dentro do painel, que só monta quando abre) ela nunca
                seria anunciada. Daqui ela acompanha o ciclo com o painel fechado. */}
            <span className="sr-only" role="status" aria-live="polite">
                {`${PHASE_LABEL[pomodoro.phase]} · ${pomodoro.running ? 'em andamento' : 'em espera'}`}
            </span>

            <Popover
                align="right"
                // No celular o gatilho fica longe da borda direita (tema e avatar
                // ocupam esse canto), então um painel ancorado à direita sairia da
                // tela pela esquerda. Abaixo de `sm` ele passa a ocupar a largura.
                className="w-80 max-sm:fixed max-sm:inset-x-3 max-sm:w-auto"
                trigger={({ open, toggle }) => (
                    <button
                        type="button"
                        onClick={toggle}
                        title="Pomodoro"
                        aria-label="Pomodoro"
                        aria-expanded={open}
                        className={cn(
                            'flex h-9 shrink-0 items-center gap-2 rounded-lg px-2.5 text-sm font-semibold tabular-nums',
                            'transition-all duration-200 active:scale-95',
                            overlay
                                ? 'bg-white/12 text-white ring-1 ring-white/20 hover:bg-white/25'
                                : cn(
                                      'bg-surface-2 ring-1 ring-border hover:bg-surface-3',
                                      // A fase é dita pela cor do ANEL, não pela do
                                      // número: `text-success` sobre `bg-surface-2` dá
                                      // 2,9:1 no tema claro, e o relógio é informação,
                                      // não enfeite. O anel é `aria-hidden` e só repete
                                      // o que o número já diz.
                                      active ? 'text-foreground' : 'text-muted-fg hover:text-foreground',
                                  ),
                        )}
                    >
                        {active ? (
                            <Ring
                                progress={pomodoro.progress}
                                size={18}
                                stroke={2.5}
                                // No quadro o cabeçalho é vidro escuro: ali o branco
                                // herdado lê melhor que o roxo da marca.
                                color={overlay ? 'currentColor' : accent(pomodoro.phase)}
                                track={overlay ? undefined : 'var(--surface-3)'}
                                className={cn('shrink-0', !pomodoro.running && 'opacity-60')}
                            />
                        ) : (
                            <Timer className="size-4.5 shrink-0" />
                        )}

                        {active && (
                            // `aria-live="off"`: o número muda a cada segundo e um
                            // leitor de tela repetiria o botão inteiro sem parar.
                            // No cabeçalho do quadro, apertado no celular, sobra só o anel.
                            <span role="timer" aria-live="off" className="hidden sm:inline">
                                {clock(pomodoro.left)}
                            </span>
                        )}
                    </button>
                )}
            >
                {() => <Panel pomodoro={pomodoro} />}
            </Popover>
        </>
    );
}

/* -------------------------------------------------------------------------- */
/* Painel                                                                      */
/* -------------------------------------------------------------------------- */

function Panel({ pomodoro }: { pomodoro: PomodoroSnapshot }) {
    const [tuning, setTuning] = useState(false);
    const reduced = usePrefersReducedMotion();
    const { phase, running, task, settings, streak, done } = pomodoro;

    return (
        // O Popover não colide com a viewport: em tela baixa (celular deitado)
        // o painel inteiro passaria do rodapé sem jeito de alcançar o fim. O
        // teto e a rolagem ficam aqui dentro, e não no Popover, para não mexer
        // no primitivo que o quadro inteiro usa.
        <div className="max-h-[calc(100dvh-5rem)] overflow-y-auto p-2">
            <div className="flex rounded-lg bg-surface-2 p-0.5">
                {PHASES.map((option) => (
                    <button
                        key={option}
                        type="button"
                        onClick={() => setPomodoroPhase(option)}
                        aria-pressed={phase === option}
                        className={cn(
                            'relative flex-1 rounded-md px-2 py-1.5 text-xs font-semibold transition-colors duration-200',
                            phase === option ? 'text-foreground' : 'text-muted-fg hover:text-foreground',
                        )}
                    >
                        {phase === option && (
                            <motion.span
                                layoutId="pomodoro-phase"
                                transition={
                                    reduced ? { duration: 0 } : { type: 'spring', stiffness: 460, damping: 36 }
                                }
                                className="absolute inset-0 rounded-md bg-surface shadow-sm ring-1 ring-border"
                            />
                        )}
                        <span className="relative">{PHASE_LABEL[option]}</span>
                    </button>
                ))}
            </div>

            <div className="relative mx-auto mt-5 grid size-40 place-items-center">
                <Ring
                    progress={pomodoro.progress}
                    size={160}
                    stroke={9}
                    color={accent(phase)}
                    track="var(--surface-2)"
                    className="absolute inset-0"
                />

                <div className="text-center">
                    <p className="text-4xl font-bold leading-none tabular-nums">{clock(pomodoro.left)}</p>
                    {/* "Em pausa" seria ambíguo aqui: a própria fase pode se
                        chamar "Pausa curta". O nome da fase vem sempre, e o
                        estado do cronômetro entra como sufixo. */}
                    <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-fg">
                        {PHASE_LABEL[phase]}
                        {!running && ' · em espera'}
                    </p>
                </div>
            </div>

            {task && (
                <div className="mt-4 flex items-center gap-1.5 rounded-lg bg-primary-soft px-2.5 py-2">
                    <Link
                        href={`/boards/${task.boardId}/cards/${task.cardId}`}
                        className="min-w-0 flex-1 truncate text-xs font-medium text-foreground hover:underline"
                        title={task.title}
                    >
                        {task.title}
                    </Link>
                    <button
                        type="button"
                        onClick={clearPomodoroTask}
                        aria-label="Desvincular o card do cronômetro"
                        className="rounded-md p-1 text-muted-fg transition-colors hover:bg-surface-3 hover:text-foreground"
                    >
                        <X className="size-3.5" />
                    </button>
                </div>
            )}

            <div className="mt-4 flex items-center gap-2">
                <button
                    type="button"
                    onClick={togglePomodoro}
                    className={cn(
                        'flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-fg',
                        'transition-[transform,filter] duration-150 hover:brightness-110 active:scale-[0.97]',
                    )}
                >
                    {running ? <Pause className="size-4 fill-current" /> : <Play className="size-4 fill-current" />}
                    {running ? 'Pausar' : 'Iniciar'}
                </button>

                <IconAction label="Reiniciar a fase" onClick={resetPomodoro}>
                    <RotateCcw className="size-4" />
                </IconAction>

                <IconAction label="Pular para a próxima fase" onClick={skipPomodoro}>
                    <SkipForward className="size-4" />
                </IconAction>

                <IconAction
                    label="Ajustes do pomodoro"
                    expanded={tuning}
                    onClick={() => setTuning((value) => !value)}
                >
                    <Settings2 className="size-4" />
                </IconAction>
            </div>

            <div className="mt-3.5 flex items-center justify-between px-0.5">
                <div className="flex items-center gap-1.5" aria-hidden>
                    {Array.from({ length: settings.longEvery }).map((_, index) => (
                        <span
                            key={index}
                            className={cn(
                                'size-1.5 rounded-full transition-colors duration-300',
                                index < streak ? 'bg-primary' : 'bg-surface-3',
                            )}
                        />
                    ))}
                </div>

                <p className="text-[11px] text-muted-fg">
                    {done === 0 ? 'Nenhum foco hoje' : `${pluralize(done, 'foco', 'focos')} hoje`}
                </p>
            </div>

            <AnimatePresence initial={false}>
                {tuning && (
                    <motion.div
                        // `scaleY` e `opacity` em vez de `height: auto` — §4.2:
                        // animar altura força reflow a cada frame.
                        initial={reduced ? false : { opacity: 0, scaleY: 0.92 }}
                        animate={{ opacity: 1, scaleY: 1 }}
                        exit={reduced ? { opacity: 0 } : { opacity: 0, scaleY: 0.94 }}
                        transition={{ duration: reduced ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
                        id="pomodoro-tuning"
                        className="origin-top"
                    >
                        <Tuning settings={settings} />
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

function Tuning({ settings }: { settings: PomodoroSettings }) {
    return (
        <div className="mt-3.5 space-y-2 border-t border-border pt-3.5">
            <Minutes label="Foco" value={settings.focus} onChange={(focus) => updatePomodoroSettings({ focus })} />
            <Minutes
                label="Pausa curta"
                value={settings.short}
                onChange={(short) => updatePomodoroSettings({ short })}
            />
            <Minutes label="Pausa longa" value={settings.long} onChange={(long) => updatePomodoroSettings({ long })} />

            <Row label="Pausa longa a cada">
                <NumberField
                    value={settings.longEvery}
                    min={2}
                    max={12}
                    suffix="focos"
                    aria-label="Focos até a pausa longa"
                    onChange={(longEvery) => updatePomodoroSettings({ longEvery })}
                />
            </Row>

            <Row label="Alarme sonoro">
                <Switch
                    label="Alarme sonoro"
                    checked={settings.sound}
                    onChange={(sound) => updatePomodoroSettings({ sound })}
                />
            </Row>

            <Row label="Emendar as fases">
                <Switch
                    label="Emendar as fases automaticamente"
                    checked={settings.autoStart}
                    onChange={(autoStart) => updatePomodoroSettings({ autoStart })}
                />
            </Row>
        </div>
    );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-fg">{label}</span>
            {children}
        </div>
    );
}

function Minutes({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
    return (
        <Row label={label}>
            <NumberField
                value={value}
                min={1}
                max={180}
                suffix="min"
                aria-label={`${label} em minutos`}
                onChange={onChange}
            />
        </Row>
    );
}

/**
 * O que está sendo digitado vive num rascunho local e só sobe para o store no
 * blur ou no Enter.
 *
 * Sem isso o campo brigaria com o usuário: o painel repinta uma vez por
 * segundo enquanto o ciclo corre, então apagar o campo para trocar o número
 * traria o valor antigo de volta em menos de um segundo, e digitar "3" antes
 * do "0" viraria "3" na hora pelo clamp.
 */
function NumberField({
    value,
    min,
    max,
    suffix,
    onChange,
    'aria-label': ariaLabel,
}: {
    value: number;
    min: number;
    max: number;
    suffix: string;
    onChange: (value: number) => void;
    'aria-label': string;
}) {
    const [draft, setDraft] = useState<string | null>(null);

    const commit = () => {
        if (draft === null) return;

        const next = Number.parseInt(draft, 10);

        setDraft(null);

        if (Number.isFinite(next)) onChange(next);
    };

    return (
        <span className="flex items-center gap-1.5">
            <input
                type="number"
                inputMode="numeric"
                min={min}
                max={max}
                value={draft ?? value}
                aria-label={ariaLabel}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={commit}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        event.currentTarget.blur();
                    }

                    if (event.key === 'Escape') setDraft(null);
                }}
                className="w-14 rounded-lg bg-surface-2 px-2 py-1 text-right text-sm font-semibold tabular-nums ring-1 ring-border focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <span className="w-8 text-xs text-muted-fg">{suffix}</span>
        </span>
    );
}

/**
 * `expanded` fica indefinido nos botões de ação pura (Reiniciar, Pular): com
 * `aria-pressed="false"` fixo o leitor de tela os anunciaria como "botão
 * alternado, não pressionado" e o usuário esperaria uma alternância que não
 * existe. Só o botão de ajustes governa uma região, e aí o atributo certo é
 * `aria-expanded`.
 */
function IconAction({
    label,
    onClick,
    expanded,
    children,
}: {
    label: string;
    onClick: () => void;
    expanded?: boolean;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            title={label}
            aria-label={label}
            aria-expanded={expanded}
            aria-controls={expanded === undefined ? undefined : 'pomodoro-tuning'}
            className={cn(
                'grid size-10 shrink-0 place-items-center rounded-lg ring-1 ring-border transition-all duration-150 active:scale-95',
                expanded
                    ? 'bg-surface-3 text-foreground'
                    : 'bg-surface-2 text-muted-fg hover:bg-surface-3 hover:text-foreground',
            )}
        >
            {children}
        </button>
    );
}

/* -------------------------------------------------------------------------- */
/* Anel                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Anel de progresso desenhado na mão — a mesma escolha do painel (SVG sem lib).
 *
 * `stroke-dashoffset` transiciona por CSS em vez de `motion`: o store repinta
 * uma vez por segundo e a transição de 1s linear costura os saltos. É a mesma
 * exceção da barra de checklist — elemento pequeno, isolado, sem reflow do
 * resto da página. O bloco de `prefers-reduced-motion` do app.css zera essa
 * duração sozinho, e o anel passa a pular de segundo em segundo.
 */
function Ring({
    progress,
    size,
    stroke,
    color = 'currentColor',
    track,
    className,
}: {
    progress: number;
    size: number;
    stroke: number;
    color?: string;
    track?: string;
    className?: string;
}) {
    const radius = (size - stroke) / 2;
    const circumference = 2 * Math.PI * radius;

    return (
        <svg
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            className={cn('-rotate-90', className)}
            aria-hidden
        >
            <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                strokeWidth={stroke}
                stroke={track ?? 'currentColor'}
                opacity={track ? 1 : 0.25}
            />
            <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                strokeWidth={stroke}
                stroke={color}
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - progress)}
                className="transition-[stroke-dashoffset] duration-1000 ease-linear"
            />
        </svg>
    );
}
