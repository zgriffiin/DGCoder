import {
  type ProviderRuntimeEvent,
  type RuntimeSessionState,
  type ThreadPostRunStage,
  type ThreadProgressPhase,
  type ThreadProgressSnapshot,
  type ThreadProgressSnapshotMap,
  type TurnId,
} from "@t3tools/contracts";
import { Effect, Layer, PubSub, Ref, Stream } from "effect";

import { ProviderService } from "../../provider/Services/ProviderService.ts";
import {
  ThreadProgressTracker,
  type ThreadProgressTrackerShape,
} from "../Services/ThreadProgressTracker.ts";

interface ThreadProgressEntry {
  readonly snapshot: ThreadProgressSnapshot;
  readonly pendingApprovalCount: number;
  readonly pendingUserInputCount: number;
  readonly lastSessionState: RuntimeSessionState | null;
}

function defaultStatusMessage(phase: ThreadProgressPhase): string | null {
  switch (phase) {
    case "starting":
      return "Starting agent session.";
    case "agent_running":
      return "Agent working.";
    case "waiting_approval":
      return "Waiting for approval.";
    case "waiting_user_input":
      return "Waiting for input.";
    case "post_processing":
      return "Agent finished. Running post-run checks.";
    case "recovering":
      return "Resyncing with provider runtime.";
    case "ready":
      return null;
    case "interrupted":
      return "Agent run interrupted.";
    case "error":
      return "Agent run failed.";
    case "stopped":
      return "Agent session stopped.";
  }
}

function postRunStageStatusMessage(stages: ReadonlyArray<ThreadPostRunStage>): string {
  if (stages.includes("quality_gate")) {
    return "Agent finished. Running quality gate.";
  }
  if (stages.includes("checkpoint_capture")) {
    return "Agent finished. Running checkpoint capture.";
  }
  if (stages.includes("assistant_finalize")) {
    return "Agent finished. Finalizing assistant output.";
  }
  return "Agent finished. Running post-run checks.";
}

function snapshotsEqual(left: ThreadProgressSnapshot, right: ThreadProgressSnapshot): boolean {
  return (
    left.threadId === right.threadId &&
    left.phase === right.phase &&
    left.activeTurnId === right.activeTurnId &&
    left.updatedAt === right.updatedAt &&
    left.lastRuntimeEventType === right.lastRuntimeEventType &&
    left.statusMessage === right.statusMessage &&
    left.source === right.source &&
    left.postRunStages.length === right.postRunStages.length &&
    left.postRunStages.every((stage, index) => stage === right.postRunStages[index])
  );
}

function deriveIdlePhase(entry: ThreadProgressEntry): ThreadProgressPhase {
  if (entry.snapshot.postRunStages.length > 0) {
    return "post_processing";
  }
  if (entry.pendingApprovalCount > 0) {
    return "waiting_approval";
  }
  if (entry.pendingUserInputCount > 0) {
    return "waiting_user_input";
  }
  if (entry.snapshot.activeTurnId !== null) {
    return "agent_running";
  }
  switch (entry.lastSessionState) {
    case "starting":
      return "starting";
    case "ready":
      return "ready";
    case "running":
    case "waiting":
      return "recovering";
    case "stopped":
      return "stopped";
    case "error":
      return "error";
    default:
      return "recovering";
  }
}

function statusMessageForPhase(
  phase: ThreadProgressPhase,
  currentStages: ReadonlyArray<ThreadPostRunStage>,
  explicit?: string | null | undefined,
): string | null {
  if (explicit !== undefined) {
    return explicit;
  }
  if (phase === "post_processing") {
    return postRunStageStatusMessage(currentStages);
  }
  return defaultStatusMessage(phase);
}

export const makeThreadProgressTracker = Effect.gen(function* () {
  const providerService = yield* ProviderService;
  const pubSub = yield* PubSub.unbounded<ThreadProgressSnapshot>();
  const state = yield* Ref.make<Record<string, ThreadProgressEntry>>({});

  const publishIfChanged = (
    threadId: string,
    updater: (entry: ThreadProgressEntry | null) => ThreadProgressEntry | null,
  ) =>
    Ref.modify(state, (current) => {
      const previous = current[threadId] ?? null;
      const next = updater(previous);
      if (next === null) {
        if (previous === null) {
          return [Effect.void, current] as const;
        }
        const nextState = { ...current };
        delete nextState[threadId];
        return [Effect.void, nextState] as const;
      }
      if (previous && snapshotsEqual(previous.snapshot, next.snapshot)) {
        return [Effect.void, { ...current, [threadId]: next }] as const;
      }
      return [
        PubSub.publish(pubSub, next.snapshot).pipe(
          Effect.asVoid,
          Effect.tap(() =>
            Effect.logDebug("thread progress updated", {
              threadId,
              phase: next.snapshot.phase,
              activeTurnId: next.snapshot.activeTurnId,
              postRunStages: next.snapshot.postRunStages,
              lastRuntimeEventType: next.snapshot.lastRuntimeEventType,
            }),
          ),
        ),
        { ...current, [threadId]: next },
      ] as const;
    }).pipe(Effect.flatten);

  const withSnapshot = (
    event: ProviderRuntimeEvent,
    update: (entry: ThreadProgressEntry | null) => ThreadProgressEntry,
  ) => publishIfChanged(event.threadId, update);

  const toEntry = (input: {
    readonly threadId: string;
    readonly phase: ThreadProgressPhase;
    readonly updatedAt: string;
    readonly activeTurnId: TurnId | null;
    readonly postRunStages?: ReadonlyArray<ThreadPostRunStage> | undefined;
    readonly lastRuntimeEventType?: string | null | undefined;
    readonly statusMessage?: string | null | undefined;
    readonly pendingApprovalCount?: number | undefined;
    readonly pendingUserInputCount?: number | undefined;
    readonly lastSessionState?: RuntimeSessionState | null | undefined;
  }): ThreadProgressEntry => ({
    snapshot: {
      threadId: input.threadId as ThreadProgressSnapshot["threadId"],
      phase: input.phase,
      activeTurnId: input.activeTurnId,
      postRunStages: [...(input.postRunStages ?? [])],
      lastRuntimeEventType: input.lastRuntimeEventType ?? null,
      statusMessage: statusMessageForPhase(
        input.phase,
        input.postRunStages ?? [],
        input.statusMessage,
      ),
      updatedAt: input.updatedAt,
      source: "provider-runtime",
    },
    pendingApprovalCount: input.pendingApprovalCount ?? 0,
    pendingUserInputCount: input.pendingUserInputCount ?? 0,
    lastSessionState: input.lastSessionState ?? null,
  });

  const applyRuntimeEvent = (event: ProviderRuntimeEvent) => {
    switch (event.type) {
      case "session.started":
        return withSnapshot(event, (entry) =>
          toEntry({
            threadId: event.threadId,
            phase: "starting",
            updatedAt: event.createdAt,
            activeTurnId: entry?.snapshot.activeTurnId ?? null,
            postRunStages: entry?.snapshot.postRunStages,
            lastRuntimeEventType: event.type,
            statusMessage: event.payload.message ?? undefined,
            pendingApprovalCount: entry?.pendingApprovalCount,
            pendingUserInputCount: entry?.pendingUserInputCount,
            lastSessionState: "starting",
          }),
        );
      case "session.state.changed":
        return withSnapshot(event, (entry) => {
          const current =
            entry ??
            toEntry({
              threadId: event.threadId,
              phase: "recovering",
              updatedAt: event.createdAt,
              activeTurnId: null,
              lastSessionState: event.payload.state,
            });
          const lastSessionState = event.payload.state;
          let phase: ThreadProgressPhase;
          switch (event.payload.state) {
            case "starting":
              phase = "starting";
              break;
            case "ready":
              phase = current.snapshot.postRunStages.length > 0 ? "post_processing" : "ready";
              break;
            case "running":
            case "waiting":
              phase = deriveIdlePhase({
                ...current,
                lastSessionState,
              });
              break;
            case "stopped":
              phase = "stopped";
              break;
            case "error":
              phase = "error";
              break;
          }
          return toEntry({
            threadId: event.threadId,
            phase,
            updatedAt: event.createdAt,
            activeTurnId:
              phase === "agent_running"
                ? current.snapshot.activeTurnId
                : current.snapshot.activeTurnId,
            postRunStages: current.snapshot.postRunStages,
            lastRuntimeEventType: event.type,
            statusMessage: event.payload.reason ?? undefined,
            pendingApprovalCount: current.pendingApprovalCount,
            pendingUserInputCount: current.pendingUserInputCount,
            lastSessionState,
          });
        });
      case "turn.started":
        return withSnapshot(event, (entry) =>
          toEntry({
            threadId: event.threadId,
            phase: "agent_running",
            updatedAt: event.createdAt,
            activeTurnId: event.turnId ?? null,
            postRunStages: [],
            lastRuntimeEventType: event.type,
            pendingApprovalCount: 0,
            pendingUserInputCount: 0,
            lastSessionState: entry?.lastSessionState ?? "running",
          }),
        );
      case "content.delta":
      case "turn.proposed.delta":
      case "turn.proposed.completed":
      case "item.started":
      case "item.updated":
      case "item.completed":
      case "tool.progress":
      case "tool.summary":
      case "task.started":
      case "task.progress":
      case "task.completed":
      case "hook.started":
      case "hook.progress":
      case "hook.completed":
        return withSnapshot(event, (entry) => {
          if (!entry) {
            return toEntry({
              threadId: event.threadId,
              phase: event.turnId ? "agent_running" : "recovering",
              updatedAt: event.createdAt,
              activeTurnId: event.turnId ?? null,
              lastRuntimeEventType: event.type,
              lastSessionState: "running",
            });
          }
          const nextActiveTurnId = event.turnId ?? entry.snapshot.activeTurnId;
          const phase =
            nextActiveTurnId !== null && entry.snapshot.phase !== "post_processing"
              ? "agent_running"
              : entry.snapshot.phase;
          return toEntry({
            threadId: event.threadId,
            phase,
            updatedAt: event.createdAt,
            activeTurnId: nextActiveTurnId,
            postRunStages: entry.snapshot.postRunStages,
            lastRuntimeEventType: event.type,
            pendingApprovalCount: entry.pendingApprovalCount,
            pendingUserInputCount: entry.pendingUserInputCount,
            lastSessionState: entry.lastSessionState ?? "running",
          });
        });
      case "request.opened":
        return withSnapshot(event, (entry) => {
          const current =
            entry ??
            toEntry({
              threadId: event.threadId,
              phase: "recovering",
              updatedAt: event.createdAt,
              activeTurnId: event.turnId ?? null,
            });
          const isUserInput = event.payload.requestType === "tool_user_input";
          const pendingApprovalCount = isUserInput
            ? current.pendingApprovalCount
            : current.pendingApprovalCount + 1;
          const pendingUserInputCount = isUserInput
            ? current.pendingUserInputCount + 1
            : current.pendingUserInputCount;
          return toEntry({
            threadId: event.threadId,
            phase: isUserInput ? "waiting_user_input" : "waiting_approval",
            updatedAt: event.createdAt,
            activeTurnId: event.turnId ?? current.snapshot.activeTurnId,
            postRunStages: current.snapshot.postRunStages,
            lastRuntimeEventType: event.type,
            statusMessage: event.payload.detail ?? undefined,
            pendingApprovalCount,
            pendingUserInputCount,
            lastSessionState: current.lastSessionState,
          });
        });
      case "user-input.requested":
        return withSnapshot(event, (entry) => {
          const current =
            entry ??
            toEntry({
              threadId: event.threadId,
              phase: "recovering",
              updatedAt: event.createdAt,
              activeTurnId: event.turnId ?? null,
            });
          return toEntry({
            threadId: event.threadId,
            phase: "waiting_user_input",
            updatedAt: event.createdAt,
            activeTurnId: event.turnId ?? current.snapshot.activeTurnId,
            postRunStages: current.snapshot.postRunStages,
            lastRuntimeEventType: event.type,
            pendingApprovalCount: current.pendingApprovalCount,
            pendingUserInputCount: current.pendingUserInputCount + 1,
            lastSessionState: current.lastSessionState,
          });
        });
      case "request.resolved":
      case "user-input.resolved":
        return withSnapshot(event, (entry) => {
          const current =
            entry ??
            toEntry({
              threadId: event.threadId,
              phase: "recovering",
              updatedAt: event.createdAt,
              activeTurnId: event.turnId ?? null,
            });
          const pendingApprovalCount =
            event.type === "request.resolved" &&
            event.payload.requestType !== "tool_user_input" &&
            current.pendingApprovalCount > 0
              ? current.pendingApprovalCount - 1
              : current.pendingApprovalCount;
          const pendingUserInputCount =
            (event.type === "user-input.resolved" ||
              (event.type === "request.resolved" &&
                event.payload.requestType === "tool_user_input")) &&
            current.pendingUserInputCount > 0
              ? current.pendingUserInputCount - 1
              : current.pendingUserInputCount;
          const nextEntry: ThreadProgressEntry = {
            ...current,
            pendingApprovalCount,
            pendingUserInputCount,
          };
          const phase = deriveIdlePhase(nextEntry);
          return toEntry({
            threadId: event.threadId,
            phase,
            updatedAt: event.createdAt,
            activeTurnId: current.snapshot.activeTurnId,
            postRunStages: current.snapshot.postRunStages,
            lastRuntimeEventType: event.type,
            pendingApprovalCount,
            pendingUserInputCount,
            lastSessionState: current.lastSessionState,
          });
        });
      case "turn.completed":
        return withSnapshot(event, (entry) => {
          const current =
            entry ??
            toEntry({
              threadId: event.threadId,
              phase: "ready",
              updatedAt: event.createdAt,
              activeTurnId: null,
            });
          const phase =
            current.snapshot.postRunStages.length > 0
              ? "post_processing"
              : event.payload.state === "failed"
                ? "error"
                : "ready";
          return toEntry({
            threadId: event.threadId,
            phase,
            updatedAt: event.createdAt,
            activeTurnId: null,
            postRunStages: current.snapshot.postRunStages,
            lastRuntimeEventType: event.type,
            statusMessage: event.payload.errorMessage ?? undefined,
            pendingApprovalCount: 0,
            pendingUserInputCount: 0,
            lastSessionState: phase === "error" ? "error" : "ready",
          });
        });
      case "turn.aborted":
        return withSnapshot(event, (_entry) =>
          toEntry({
            threadId: event.threadId,
            phase: "interrupted",
            updatedAt: event.createdAt,
            activeTurnId: null,
            postRunStages: [],
            lastRuntimeEventType: event.type,
            statusMessage: event.payload.reason,
            pendingApprovalCount: 0,
            pendingUserInputCount: 0,
            lastSessionState: "stopped",
          }),
        );
      case "session.exited":
        return withSnapshot(event, (_entry) =>
          toEntry({
            threadId: event.threadId,
            phase: "stopped",
            updatedAt: event.createdAt,
            activeTurnId: null,
            postRunStages: [],
            lastRuntimeEventType: event.type,
            statusMessage: event.payload.reason ?? undefined,
            pendingApprovalCount: 0,
            pendingUserInputCount: 0,
            lastSessionState: "stopped",
          }),
        );
      case "runtime.error":
        return withSnapshot(event, (entry) =>
          toEntry({
            threadId: event.threadId,
            phase: "error",
            updatedAt: event.createdAt,
            activeTurnId: null,
            postRunStages: [],
            lastRuntimeEventType: event.type,
            statusMessage: event.payload.message,
            pendingApprovalCount: entry?.pendingApprovalCount ?? 0,
            pendingUserInputCount: entry?.pendingUserInputCount ?? 0,
            lastSessionState: "error",
          }),
        );
      case "runtime.warning":
        return withSnapshot(event, (entry) => {
          const current =
            entry ??
            toEntry({
              threadId: event.threadId,
              phase: "recovering",
              updatedAt: event.createdAt,
              activeTurnId: event.turnId ?? null,
            });
          const phase =
            current.snapshot.phase === "waiting_approval" ||
            current.snapshot.phase === "waiting_user_input" ||
            current.snapshot.phase === "post_processing"
              ? current.snapshot.phase
              : current.snapshot.activeTurnId !== null
                ? "agent_running"
                : "recovering";
          return toEntry({
            threadId: event.threadId,
            phase,
            updatedAt: event.createdAt,
            activeTurnId: current.snapshot.activeTurnId,
            postRunStages: current.snapshot.postRunStages,
            lastRuntimeEventType: event.type,
            statusMessage: event.payload.message,
            pendingApprovalCount: current.pendingApprovalCount,
            pendingUserInputCount: current.pendingUserInputCount,
            lastSessionState: current.lastSessionState ?? "running",
          });
        });
      default:
        return Effect.void;
    }
  };

  const markPostRunStageStart: ThreadProgressTrackerShape["markPostRunStageStart"] = (input) =>
    publishIfChanged(input.threadId, (entry) => {
      const current =
        entry ??
        toEntry({
          threadId: input.threadId,
          phase: "post_processing",
          updatedAt: input.updatedAt,
          activeTurnId: input.turnId,
        });
      const postRunStages = current.snapshot.postRunStages.includes(input.stage)
        ? current.snapshot.postRunStages
        : [...current.snapshot.postRunStages, input.stage];
      return toEntry({
        threadId: input.threadId,
        phase: "post_processing",
        updatedAt: input.updatedAt,
        activeTurnId: input.turnId,
        postRunStages,
        lastRuntimeEventType: input.lastRuntimeEventType ?? current.snapshot.lastRuntimeEventType,
        statusMessage: input.statusMessage ?? undefined,
        pendingApprovalCount: current.pendingApprovalCount,
        pendingUserInputCount: current.pendingUserInputCount,
        lastSessionState: current.lastSessionState ?? "ready",
      });
    });

  const markPostRunStageEnd: ThreadProgressTrackerShape["markPostRunStageEnd"] = (input) =>
    publishIfChanged(input.threadId, (entry) => {
      const current =
        entry ??
        toEntry({
          threadId: input.threadId,
          phase: input.fallbackPhase ?? "ready",
          updatedAt: input.updatedAt,
          activeTurnId: input.turnId,
        });
      const postRunStages = current.snapshot.postRunStages.filter((stage) => stage !== input.stage);
      const phase = postRunStages.length > 0 ? "post_processing" : (input.fallbackPhase ?? "ready");
      return toEntry({
        threadId: input.threadId,
        phase,
        updatedAt: input.updatedAt,
        activeTurnId: phase === "agent_running" ? input.turnId : null,
        postRunStages,
        lastRuntimeEventType: input.lastRuntimeEventType ?? current.snapshot.lastRuntimeEventType,
        statusMessage: input.statusMessage ?? undefined,
        pendingApprovalCount: current.pendingApprovalCount,
        pendingUserInputCount: current.pendingUserInputCount,
        lastSessionState:
          phase === "error"
            ? "error"
            : phase === "stopped"
              ? "stopped"
              : phase === "interrupted"
                ? "stopped"
                : "ready",
      });
    });

  const markThreadPhase: ThreadProgressTrackerShape["markThreadPhase"] = (input) =>
    publishIfChanged(input.threadId, (entry) => {
      const current =
        entry ??
        toEntry({
          threadId: input.threadId,
          phase: input.phase,
          updatedAt: input.updatedAt,
          activeTurnId: input.activeTurnId ?? null,
        });
      const postRunStages =
        input.phase === "post_processing"
          ? current.snapshot.postRunStages
          : input.phase === "error" || input.phase === "ready" || input.phase === "interrupted"
            ? []
            : current.snapshot.postRunStages;
      return toEntry({
        threadId: input.threadId,
        phase: input.phase,
        updatedAt: input.updatedAt,
        activeTurnId: input.activeTurnId ?? current.snapshot.activeTurnId ?? null,
        postRunStages,
        lastRuntimeEventType: input.lastRuntimeEventType ?? current.snapshot.lastRuntimeEventType,
        statusMessage: input.statusMessage ?? undefined,
        pendingApprovalCount: current.pendingApprovalCount,
        pendingUserInputCount: current.pendingUserInputCount,
        lastSessionState:
          input.phase === "error"
            ? "error"
            : input.phase === "stopped"
              ? "stopped"
              : input.phase === "starting"
                ? "starting"
                : current.lastSessionState,
      });
    });

  const start: ThreadProgressTrackerShape["start"] = Effect.fn("start")(function* () {
    yield* Effect.forkScoped(Stream.runForEach(providerService.streamEvents, applyRuntimeEvent));
  });

  const getSnapshot: ThreadProgressTrackerShape["getSnapshot"] = () =>
    Ref.get(state).pipe(
      Effect.map(
        (entries) =>
          Object.fromEntries(
            Object.entries(entries).map(([threadId, entry]) => [threadId, entry.snapshot]),
          ) as ThreadProgressSnapshotMap,
      ),
    );

  return {
    start,
    getSnapshot,
    get streamSnapshots() {
      return Stream.fromPubSub(pubSub);
    },
    markPostRunStageStart,
    markPostRunStageEnd,
    markThreadPhase,
  } satisfies ThreadProgressTrackerShape;
});

export const ThreadProgressTrackerLive = Layer.effect(
  ThreadProgressTracker,
  makeThreadProgressTracker,
);
