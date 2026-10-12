import { toast } from 'sonner';

/**
 * Pomodoro — a única peça de estado que não mora no servidor.
 *
 * O quadro segue a regra da seção 3.2 do BOAS_PRATICAS (o servidor é o store),
 * mas um cronômetro não tem contrapartida no banco: ele é do navegador, do
 * usuário, daquela sessão — o mesmo desenho do tema em `use-appearance.ts`,
 * que também não tem rota de salvar. Por isso vive num store de módulo em vez
 * de `useState`: cada página do Next monta o seu próprio `AppLayout`, então
 * estado de componente morreria ao sair de `/boards` para `/boards/7`.
 *
 * O relógio é sempre `endsAt - Date.now()`, nunca um contador incrementado a
 * cada tick: aba em segundo plano tem `setInterval` estrangulado pelo
 * navegador e um contador acumulado atrasaria minutos.
 */

const KEY = 'pomodoro';

/** Acima disso, a fase que venceu com a aba fechada vira em silêncio. */
const STALE = 120_000;

export type PomodoroPhase = 'focus' | 'short' | 'long';

export const PHASE_LABEL: Record<PomodoroPhase, string> = {
    focus: 'Foco',
    short: 'Pausa curta',
    long: 'Pausa longa',
};

/** Card que puxou o ciclo — o widget mostra o título e linka de volta. */
export interface PomodoroTask {
    cardId: number;
    boardId: number;
    title: string;
}

export interface PomodoroSettings {
    /** Minutos. */
    focus: number;
    short: number;
    long: number;
    /** A cada N focos concluídos a pausa é longa. */
    longEvery: number;
    sound: boolean;
    autoStart: boolean;
}

interface PomodoroState {
    phase: PomodoroPhase;
    /** Instante do fim em epoch ms. `null` quando o ciclo está parado. */
    endsAt: number | null;
    /** Quanto falta, em ms. Só é a fonte da verdade quando `endsAt` é `null`. */
    left: number;
    /** Focos concluídos desde a última pausa longa. */
    streak: number;
    /** Focos concluídos hoje. */
    done: number;
    /** Dia dos contadores — vira a meia-noite e `done` zera. */
    day: string;
    task: PomodoroTask | null;
    /** Dono do ciclo. Máquina compartilhada não herda o card de quem saiu. */
    userId: number | null;
    settings: PomodoroSettings;
}

export interface PomodoroSnapshot extends PomodoroState {
    running: boolean;
    /** 0 a 1 da fase atual, para o anel. */
    progress: number;
}

const DEFAULTS: PomodoroSettings = {
    focus: 25,
    short: 5,
    long: 15,
    longEvery: 4,
    sound: true,
    autoStart: false,
};

/** Limites de sanidade: o valor também chega de um `localStorage` editável. */
const LIMITS: Record<'focus' | 'short' | 'long' | 'longEvery', [number, number]> = {
    focus: [1, 180],
    short: [1, 60],
    long: [1, 90],
    longEvery: [2, 12],
};

/* -------------------------------------------------------------------------- */
/* Estado                                                                      */
/* -------------------------------------------------------------------------- */

function today(): string {
    const now = new Date();

    return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

function clamp(key: keyof typeof LIMITS, value: unknown): number {
    const [min, max] = LIMITS[key];
    const number = Math.round(Number(value));

    if (!Number.isFinite(number)) return DEFAULTS[key];

    return Math.min(max, Math.max(min, number));
}

function blank(): PomodoroState {
    return {
        phase: 'focus',
        endsAt: null,
        left: DEFAULTS.focus * 60_000,
        streak: 0,
        done: 0,
        day: today(),
        task: null,
        userId: null,
        settings: { ...DEFAULTS },
    };
}

/** Duração cheia da fase, em ms. */
function full(phase: PomodoroPhase, settings: PomodoroSettings): number {
    return settings[phase] * 60_000;
}

function read(): PomodoroState {
    const base = blank();

    if (typeof window === 'undefined') return base;

    try {
        const raw = window.localStorage.getItem(KEY);

        if (!raw) return base;

        const saved = JSON.parse(raw) as Partial<PomodoroState>;
        const settings: PomodoroSettings = {
            focus: clamp('focus', saved.settings?.focus ?? DEFAULTS.focus),
            short: clamp('short', saved.settings?.short ?? DEFAULTS.short),
            long: clamp('long', saved.settings?.long ?? DEFAULTS.long),
            longEvery: clamp('longEvery', saved.settings?.longEvery ?? DEFAULTS.longEvery),
            sound: saved.settings?.sound !== false,
            autoStart: saved.settings?.autoStart === true,
        };

        const phase: PomodoroPhase = saved.phase === 'short' || saved.phase === 'long' ? saved.phase : 'focus';
        const day = today();

        return {
            phase,
            endsAt: typeof saved.endsAt === 'number' ? saved.endsAt : null,
            left: typeof saved.left === 'number' ? saved.left : full(phase, settings),
            streak: typeof saved.streak === 'number' ? saved.streak : 0,
            // Contador é do dia: se a aba dormiu até amanhã, começa do zero.
            done: saved.day === day && typeof saved.done === 'number' ? saved.done : 0,
            day,
            task: saved.task ?? null,
            userId: typeof saved.userId === 'number' ? saved.userId : null,
            settings,
        };
    } catch {
        // JSON corrompido não pode derrubar o cabeçalho inteiro.
        return base;
    }
}

let state: PomodoroState = read();
let ticker: ReturnType<typeof setInterval> | null = null;
/** Último segundo já pintado — evita re-render 4x por segundo. */
let painted = -1;
/** Falso quando o navegador recusa o `localStorage` (aba anônima, cota cheia). */
let persisted = true;

const listeners = new Set<() => void>();

function remaining(): number {
    const left = state.endsAt === null ? state.left : state.endsAt - Date.now();

    // O relógio do sistema pode andar para trás (NTP, troca de fuso, o usuário
    // acertando a hora). Sem o teto o mostrador passaria da duração da fase e
    // o anel voltaria a encher.
    return Math.min(full(state.phase, state.settings), Math.max(0, left));
}

function build(): PomodoroSnapshot {
    const total = full(state.phase, state.settings);
    const left = remaining();

    return {
        ...state,
        left,
        running: state.endsAt !== null,
        progress: total > 0 ? Math.min(1, Math.max(0, 1 - left / total)) : 0,
    };
}

let snapshot: PomodoroSnapshot = build();

export const EMPTY_POMODORO: PomodoroSnapshot = { ...blank(), running: false, progress: 0 };

function write() {
    try {
        window.localStorage.setItem(KEY, JSON.stringify(state));
        persisted = true;
    } catch {
        // O ciclo continua valendo em memória; só não sobrevive ao F5.
        persisted = false;
    }
}

function emit() {
    painted = Math.ceil(remaining() / 1000);
    snapshot = build();
    syncTitle();
    listeners.forEach((listener) => listener());
}

/** Liga o tick só enquanto há algo correndo. Parado não gasta timer. */
function schedule() {
    const running = state.endsAt !== null;

    if (running && ticker === null) {
        ticker = setInterval(pulse, 250);
    } else if (!running && ticker !== null) {
        clearInterval(ticker);
        ticker = null;
    }
}

function commit(next: PomodoroState) {
    state = next;
    write();
    schedule();
    emit();
}

function pulse() {
    if (state.endsAt === null) return;

    if (Date.now() >= state.endsAt) {
        complete();

        return;
    }

    // 250ms de tick para reagir rápido ao fim, mas só repinta quando o
    // segundo exibido muda.
    const second = Math.ceil(remaining() / 1000);

    if (second !== painted) emit();
}

/** Qual fase vem depois — determinística, para duas abas chegarem no mesmo lugar. */
function nextPhase(current: PomodoroState): { phase: PomodoroPhase; streak: number } {
    if (current.phase !== 'focus') {
        return { phase: 'focus', streak: current.streak };
    }

    const streak = current.streak + 1;
    const long = streak % current.settings.longEvery === 0;

    return { phase: long ? 'long' : 'short', streak: long ? 0 : streak };
}

function complete() {
    // Com duas abas abertas as duas chegam no zero. A que perder a corrida
    // encontra o estado já virado no `localStorage` e só o adota — senão o
    // alarme tocaria duas vezes e o contador pularia dois.
    //
    // Sem persistência não há corrida possível, e ler devolveria o estado
    // vazio: aí a checagem zeraria o ciclo em vez de concluí-lo.
    if (persisted) {
        const stored = read();

        if (stored.endsAt !== state.endsAt || stored.phase !== state.phase) {
            adopt(stored);

            return;
        }
    }

    // A fase pode ter vencido há horas, com a aba fechada. Avisar agora seria
    // um alarme fantasma sobre um foco que ninguém estava fazendo: vira a fase
    // calada e deixa o widget já no estado certo.
    const stale = state.endsAt !== null && Date.now() - state.endsAt > STALE;

    const finished = state.phase;
    const { phase, streak } = nextPhase(state);
    const duration = full(phase, state.settings);
    const day = today();
    const carried = state.day === day ? state.done : 0;

    const next: PomodoroState = {
        ...state,
        phase,
        // Foco fantasma não conta em lugar nenhum: se não entra em "focos
        // hoje", também não pode adiantar a pausa longa — senão os dois
        // contadores da mesma tela discordariam.
        streak: stale ? state.streak : streak,
        day,
        done: finished === 'focus' && !stale ? carried + 1 : carried,
        left: duration,
        endsAt: !stale && state.settings.autoStart ? Date.now() + duration : null,
    };

    commit(next);

    if (stale) return;

    announce(finished, next);

    if (next.settings.sound) chime(finished === 'focus');
}

function announce(finished: PomodoroPhase, next: PomodoroState) {
    const title =
        finished === 'focus'
            ? next.task
                ? `Foco concluído — ${next.task.title}`
                : 'Foco concluído!'
            : 'Pausa encerrada.';

    toast.success(title, {
        description: next.endsAt
            ? `${PHASE_LABEL[next.phase]} de ${next.settings[next.phase]} min já começou.`
            : `${PHASE_LABEL[next.phase]} de ${next.settings[next.phase]} min esperando o play.`,
    });
}

function adopt(next: PomodoroState) {
    state = next;
    schedule();
    emit();
}

/* -------------------------------------------------------------------------- */
/* Som                                                                         */
/* -------------------------------------------------------------------------- */

let audio: AudioContext | null = null;

/**
 * O contexto de áudio só nasce vivo se criado dentro de um gesto do usuário —
 * por isso é o clique em "Iniciar" que o abre, e não o fim do ciclo.
 */
export function primePomodoroAudio() {
    try {
        audio ??= new AudioContext();

        if (audio.state === 'suspended') void audio.resume();
    } catch {
        audio = null;
    }
}

/** Dois bipes curtos em seno: sem arquivo, sem request, sem lib. */
function chime(finishedFocus: boolean) {
    const context = audio;

    if (!context) return;

    void context.resume();

    const start = context.currentTime + 0.02;
    const notes = finishedFocus ? [880, 1318.5] : [659.3, 880];

    notes.forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const at = start + index * 0.19;

        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;

        // Rampa exponencial não aceita zero — daí o 0.0001 nas pontas.
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.2, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.34);

        oscillator.connect(gain).connect(context.destination);
        oscillator.start(at);
        oscillator.stop(at + 0.38);
    });
}

/* -------------------------------------------------------------------------- */
/* Título da aba                                                               */
/* -------------------------------------------------------------------------- */

let baseTitle = '';
let ourTitle = '';

/**
 * Mostra o tempo na aba — é o que faz o ciclo continuar visível quando o
 * usuário sai para outra aba. O Next reescreve `document.title` a cada
 * navegação, então tudo que não fomos nós que escrevemos vira o novo título
 * base; sem isso o prefixo se empilharia a cada página.
 */
function syncTitle() {
    if (typeof document === 'undefined') return;

    if (document.title !== ourTitle) baseTitle = document.title;

    ourTitle = state.endsAt === null ? baseTitle : `${clock(remaining())} · ${baseTitle}`;
    document.title = ourTitle;
}

export function clock(ms: number): string {
    const total = Math.ceil(Math.max(0, ms) / 1000);

    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/* -------------------------------------------------------------------------- */
/* Ações                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Amarra o ciclo ao usuário logado. Numa máquina compartilhada o
 * `localStorage` sobrevive ao logout, e `task.title` é o título de um card de
 * quadro privado: quem entrar depois não pode ver aquilo no cabeçalho.
 *
 * As preferências de duração ficam — são do navegador, como o tema.
 */
export function claimPomodoro(userId: number) {
    if (state.userId === userId) return;

    if (state.userId === null) {
        commit({ ...state, userId });

        return;
    }

    commit({
        ...blank(),
        userId,
        settings: state.settings,
        left: full('focus', state.settings),
    });
}

/**
 * Solta o ciclo ao sair da conta.
 *
 * O logout é navegação de cliente: o módulo continua vivo, com o
 * `setInterval` de pé. Sem isso a tela de login herdaria o relógio no título da
 * aba e, no fim da fase, um toast com o título de um card de quadro privado —
 * na frente de quem quer que esteja na máquina. `claimPomodoro` só protege a
 * entrada; esta é a saída.
 */
export function releasePomodoro() {
    // Sem nada a soltar, cada navegação de visitante reescreveria o
    // `localStorage` e acordaria o `storage` das outras abas à toa.
    if (state.userId === null && state.task === null && state.endsAt === null) return;

    commit({ ...blank(), settings: state.settings, left: full('focus', state.settings) });
}

export function startPomodoro() {
    if (state.endsAt !== null) return;

    primePomodoroAudio();
    commit({ ...state, endsAt: Date.now() + Math.max(1000, remaining()) });
}

export function pausePomodoro() {
    if (state.endsAt === null) return;

    commit({ ...state, left: remaining(), endsAt: null });
}

export function togglePomodoro() {
    if (state.endsAt === null) startPomodoro();
    else pausePomodoro();
}

/** Volta a fase atual para o começo, parada. */
export function resetPomodoro() {
    commit({ ...state, endsAt: null, left: full(state.phase, state.settings) });
}

/** Pula para a próxima fase sem contar o ciclo — não é conclusão, é desistência. */
export function skipPomodoro() {
    setPomodoroPhase(state.phase === 'focus' ? 'short' : 'focus');
}

export function setPomodoroPhase(phase: PomodoroPhase) {
    // Clicar na aba que já está marcada não pode apagar um foco em andamento:
    // ela parece um no-op, e quem quer zerar tem o botão "Reiniciar" ao lado.
    if (phase === state.phase) return;

    commit({ ...state, phase, endsAt: null, left: full(phase, state.settings) });
}

/**
 * Começa (ou recomeça) um foco amarrado a um card. Descarta de propósito uma
 * pausa em andamento: quem clica em "focar neste card" está dizendo que a
 * pausa acabou.
 */
export function focusOnCard(task: PomodoroTask) {
    primePomodoroAudio();

    const duration = full('focus', state.settings);

    commit({ ...state, task, phase: 'focus', left: duration, endsAt: Date.now() + duration });
}

export function clearPomodoroTask() {
    commit({ ...state, task: null });
}

export function updatePomodoroSettings(patch: Partial<PomodoroSettings>) {
    const settings: PomodoroSettings = {
        ...state.settings,
        ...patch,
        focus: clamp('focus', patch.focus ?? state.settings.focus),
        short: clamp('short', patch.short ?? state.settings.short),
        long: clamp('long', patch.long ?? state.settings.long),
        longEvery: clamp('longEvery', patch.longEvery ?? state.settings.longEvery),
    };

    const before = full(state.phase, state.settings);
    const after = full(state.phase, settings);

    // Os dois ramos aplicam a MESMA diferença — "25 → 30" acrescenta cinco
    // minutos esteja o ciclo correndo ou pausado. Tratar os dois de formas
    // opostas era o que fazia o anel andar para trás sem o relógio ganhar
    // tempo. Uma fase intocada continua caindo exatamente na duração nova.
    const shift = after - before;

    if (state.endsAt === null) {
        commit({ ...state, settings, left: Math.min(after, Math.max(1000, state.left + shift)) });

        return;
    }

    commit({ ...state, settings, endsAt: Math.max(Date.now() + 1000, state.endsAt + shift) });
}

/* -------------------------------------------------------------------------- */
/* Assinatura                                                                  */
/* -------------------------------------------------------------------------- */

export function subscribePomodoro(listener: () => void): () => void {
    listeners.add(listener);

    return () => {
        listeners.delete(listener);
    };
}

export function pomodoroSnapshot(): PomodoroSnapshot {
    return snapshot;
}

if (typeof window !== 'undefined') {
    // Outra aba mexeu no ciclo. `storage` só dispara nas outras abas, então não
    // há eco do próprio `write()`.
    window.addEventListener('storage', (event) => {
        if (event.key === KEY) adopt(read());
    });

    // Aba em segundo plano tem o `setInterval` estrangulado; ao voltar, acerta
    // o relógio no mesmo frame em vez de esperar o próximo tick. `pageshow`
    // cobre a volta pelo bfcache, onde `visibilitychange` não dispara.
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) pulse();
    });
    window.addEventListener('pageshow', () => pulse());
    window.addEventListener('focus', () => pulse());

    schedule();
}
