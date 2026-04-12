export const BACKEND_CRASH_LOOP_MAX_EXITS = 3;
export const BACKEND_CRASH_LOOP_WINDOW_MS = 60_000;
export const BACKEND_HEALTHY_UPTIME_MS = 30_000;

export interface BackendUnexpectedExit {
  readonly atMs: number;
  readonly lastErrorSnippet: string | null;
  readonly pid: number | null;
  readonly reason: string;
  readonly uptimeMs: number;
}

export interface BackendCrashLoopState {
  readonly unexpectedExits: ReadonlyArray<BackendUnexpectedExit>;
}

export interface BackendCrashLoopDecision {
  readonly state: BackendCrashLoopState;
  readonly shouldStopRestarting: boolean;
}

const INITIAL_BACKEND_CRASH_LOOP_STATE: BackendCrashLoopState = Object.freeze({
  unexpectedExits: [],
});

export function createBackendCrashLoopState(): BackendCrashLoopState {
  return INITIAL_BACKEND_CRASH_LOOP_STATE;
}

export function markBackendHealthy(state: BackendCrashLoopState): BackendCrashLoopState {
  return state.unexpectedExits.length === 0 ? state : INITIAL_BACKEND_CRASH_LOOP_STATE;
}

export function recordUnexpectedBackendExit(
  state: BackendCrashLoopState,
  exit: BackendUnexpectedExit,
): BackendCrashLoopDecision {
  if (exit.uptimeMs >= BACKEND_HEALTHY_UPTIME_MS) {
    return {
      state: INITIAL_BACKEND_CRASH_LOOP_STATE,
      shouldStopRestarting: false,
    };
  }

  const cutoffMs = exit.atMs - BACKEND_CRASH_LOOP_WINDOW_MS;
  const recentExits = state.unexpectedExits.filter((entry) => entry.atMs >= cutoffMs);
  const nextState = {
    unexpectedExits: [...recentExits, exit],
  } satisfies BackendCrashLoopState;

  return {
    state: nextState,
    shouldStopRestarting: nextState.unexpectedExits.length >= BACKEND_CRASH_LOOP_MAX_EXITS,
  };
}
