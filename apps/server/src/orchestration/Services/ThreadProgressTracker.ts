import type {
  ThreadPostRunStage,
  ThreadProgressPhase,
  ThreadProgressSnapshot,
  ThreadProgressSnapshotMap,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect, Scope, Stream } from "effect";

export interface ThreadProgressTrackerShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  readonly getSnapshot: () => Effect.Effect<ThreadProgressSnapshotMap, never, never>;
  readonly streamSnapshots: Stream.Stream<ThreadProgressSnapshot>;
  readonly markPostRunStageStart: (input: {
    readonly threadId: ThreadId;
    readonly turnId: TurnId | null;
    readonly stage: ThreadPostRunStage;
    readonly updatedAt: string;
    readonly statusMessage?: string | null | undefined;
    readonly lastRuntimeEventType?: string | null | undefined;
  }) => Effect.Effect<void, never, never>;
  readonly markPostRunStageEnd: (input: {
    readonly threadId: ThreadId;
    readonly turnId: TurnId | null;
    readonly stage: ThreadPostRunStage;
    readonly updatedAt: string;
    readonly fallbackPhase?: ThreadProgressPhase | undefined;
    readonly statusMessage?: string | null | undefined;
    readonly lastRuntimeEventType?: string | null | undefined;
  }) => Effect.Effect<void, never, never>;
  readonly markThreadPhase: (input: {
    readonly threadId: ThreadId;
    readonly phase: ThreadProgressPhase;
    readonly updatedAt: string;
    readonly activeTurnId?: TurnId | null | undefined;
    readonly statusMessage?: string | null | undefined;
    readonly lastRuntimeEventType?: string | null | undefined;
  }) => Effect.Effect<void, never, never>;
}

export class ThreadProgressTracker extends ServiceMap.Service<
  ThreadProgressTracker,
  ThreadProgressTrackerShape
>()("t3/orchestration/Services/ThreadProgressTracker") {}
