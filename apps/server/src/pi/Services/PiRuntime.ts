import type { AgentSession } from "@mariozechner/pi-coding-agent";
import type {
  PiAbortThreadInput,
  PiCreateThreadInput,
  PiGetThreadInput,
  PiRuntimeSnapshot,
  PiSendPromptInput,
  PiSetThreadModelInput,
  PiThreadId,
  PiThreadSnapshot,
  PiThreadStreamEvent,
  PiThreadSummary,
} from "@t3tools/contracts";
import { PiRuntimeError } from "@t3tools/contracts";
import { Effect, ServiceMap, Stream } from "effect";

export interface PiRuntimeShape {
  readonly getRuntimeSnapshot: Effect.Effect<PiRuntimeSnapshot, PiRuntimeError>;
  readonly refreshRuntimeSnapshot: Effect.Effect<PiRuntimeSnapshot, PiRuntimeError>;
  readonly listThreads: Effect.Effect<ReadonlyArray<PiThreadSummary>, PiRuntimeError>;
  readonly getThread: (input: PiGetThreadInput) => Effect.Effect<PiThreadSnapshot, PiRuntimeError>;
  readonly createThread: (
    input: PiCreateThreadInput,
  ) => Effect.Effect<PiThreadSnapshot, PiRuntimeError>;
  readonly sendPrompt: (
    input: PiSendPromptInput,
  ) => Effect.Effect<PiThreadSnapshot, PiRuntimeError>;
  readonly setThreadModel: (
    input: PiSetThreadModelInput,
  ) => Effect.Effect<PiThreadSnapshot, PiRuntimeError>;
  readonly abortThread: (
    input: PiAbortThreadInput,
  ) => Effect.Effect<PiThreadSnapshot, PiRuntimeError>;
  readonly streamEvents: Stream.Stream<PiThreadStreamEvent, PiRuntimeError>;
}

export class PiRuntime extends ServiceMap.Service<PiRuntime, PiRuntimeShape>()(
  "t3/pi/Services/PiRuntime",
) {}

export interface PiRuntimeDependencies {
  readonly cwd: string;
  readonly agentDir: string;
  readonly sessionDir: string;
}

export interface ActivePiThreadState {
  readonly threadId: PiThreadId;
  readonly sessionPath: string | undefined;
  readonly session: AgentSession;
  snapshot: PiThreadSnapshot;
  inFlightPrompt: Promise<void> | null;
  unsubscribe: (() => void) | null;
}

export interface PiThreadListInfo {
  readonly path: string;
  readonly id: string;
  readonly name: string | undefined;
  readonly created: Date;
  readonly modified: Date;
  readonly firstMessage: string;
}
