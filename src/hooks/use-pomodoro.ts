import { useSyncExternalStore } from 'react';
import { EMPTY_POMODORO, pomodoroSnapshot, subscribePomodoro, type PomodoroSnapshot } from '@/lib/pomodoro';

/**
 * Assina o cronômetro de [`lib/pomodoro.ts`](../lib/pomodoro.ts).
 *
 * Chame sempre no componente que mostra o tempo, nunca num ancestral: o store
 * emite uma vez por segundo enquanto o ciclo corre, e um `usePomodoro()` no
 * `AppLayout` faria a página inteira — inclusive o `DndContext` do quadro —
 * re-renderizar junto.
 */
export function usePomodoro(): PomodoroSnapshot {
    return useSyncExternalStore(subscribePomodoro, pomodoroSnapshot, () => EMPTY_POMODORO);
}
