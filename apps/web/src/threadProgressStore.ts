import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime";
import type {
  EnvironmentId,
  ScopedThreadRef,
  ThreadId,
  ThreadPostRunStage,
  ThreadProgressPhase,
  ThreadProgressSnapshot,
  ThreadProgressSnapshotMap,
  TurnId,
} from "@t3tools/contracts";
import { create } from "zustand";

interface ThreadProgressStoreState {
  progressByThreadKey: Record<string, ThreadProgressSnapshot>;
  recoveryOverlayByThreadKey: Record<string, ThreadProgressSnapshot>;
  syncProgressSnapshot: (
    environmentId: EnvironmentId,
    snapshotMap: ThreadProgressSnapshotMap,
  ) => void;
  applyProgressUpdate: (environmentId: EnvironmentId, snapshot: ThreadProgressSnapshot) => void;
  setRecoveryOverlay: (input: {
    threadRef: ScopedThreadRef;
    phase?: ThreadProgressPhase | undefined;
    activeTurnId?: TurnId | null | undefined;
    postRunStages?: ReadonlyArray<ThreadPostRunStage> | undefined;
    statusMessage?: string | null | undefined;
    updatedAt?: string | undefined;
  }) => void;
  clearRecoveryOverlay: (threadRef: ScopedThreadRef) => void;
  clearEnvironmentProgress: (environmentId: EnvironmentId) => void;
}

function threadKeyFor(environmentId: EnvironmentId, threadId: ThreadId): string {
  return scopedThreadKey({ environmentId, threadId });
}

function withEnvironmentPrefix(
  entries: Record<string, ThreadProgressSnapshot>,
  environmentId: EnvironmentId,
): Record<string, ThreadProgressSnapshot> {
  const next: Record<string, ThreadProgressSnapshot> = {};
  for (const [key, value] of Object.entries(entries)) {
    if (parseScopedThreadKey(key)?.environmentId === environmentId) {
      continue;
    }
    next[key] = value;
  }
  return next;
}

export const useThreadProgressStore = create<ThreadProgressStoreState>((set) => ({
  progressByThreadKey: {},
  recoveryOverlayByThreadKey: {},
  syncProgressSnapshot: (environmentId, snapshotMap) =>
    set((state) => {
      const progressByThreadKey = withEnvironmentPrefix(state.progressByThreadKey, environmentId);
      for (const [threadId, snapshot] of Object.entries(snapshotMap)) {
        progressByThreadKey[threadKeyFor(environmentId, threadId as ThreadId)] = snapshot;
      }
      return { progressByThreadKey };
    }),
  applyProgressUpdate: (environmentId, snapshot) =>
    set((state) => ({
      progressByThreadKey: {
        ...state.progressByThreadKey,
        [threadKeyFor(environmentId, snapshot.threadId)]: snapshot,
      },
    })),
  setRecoveryOverlay: (input) =>
    set((state) => {
      const threadKey = scopedThreadKey(input.threadRef);
      const previous =
        state.recoveryOverlayByThreadKey[threadKey] ?? state.progressByThreadKey[threadKey] ?? null;
      const updatedAt = input.updatedAt ?? new Date().toISOString();
      const snapshot: ThreadProgressSnapshot = {
        threadId: input.threadRef.threadId,
        phase: input.phase ?? "recovering",
        activeTurnId: input.activeTurnId ?? previous?.activeTurnId ?? null,
        postRunStages: [...(input.postRunStages ?? previous?.postRunStages ?? [])],
        lastRuntimeEventType: previous?.lastRuntimeEventType ?? null,
        statusMessage: input.statusMessage ?? "Resyncing with server.",
        updatedAt,
        source: "client-recovery",
      };
      return {
        recoveryOverlayByThreadKey: {
          ...state.recoveryOverlayByThreadKey,
          [threadKey]: snapshot,
        },
      };
    }),
  clearRecoveryOverlay: (threadRef) =>
    set((state) => {
      const threadKey = scopedThreadKey(threadRef);
      if (!state.recoveryOverlayByThreadKey[threadKey]) {
        return state;
      }
      const next = { ...state.recoveryOverlayByThreadKey };
      delete next[threadKey];
      return { recoveryOverlayByThreadKey: next };
    }),
  clearEnvironmentProgress: (environmentId) =>
    set((state) => ({
      progressByThreadKey: withEnvironmentPrefix(state.progressByThreadKey, environmentId),
      recoveryOverlayByThreadKey: withEnvironmentPrefix(
        state.recoveryOverlayByThreadKey,
        environmentId,
      ),
    })),
}));

export function selectThreadProgress(
  state: Pick<ThreadProgressStoreState, "progressByThreadKey" | "recoveryOverlayByThreadKey">,
  threadRef: ScopedThreadRef | null | undefined,
): ThreadProgressSnapshot | null {
  if (!threadRef) {
    return null;
  }
  const threadKey = scopedThreadKey(threadRef);
  return (
    state.recoveryOverlayByThreadKey[threadKey] ?? state.progressByThreadKey[threadKey] ?? null
  );
}
