import type { ProviderRuntimeEvent } from "@t3tools/contracts";
import { EventId, ThreadId, TurnId } from "@t3tools/contracts";
import { Effect, Exit, Layer, ManagedRuntime, PubSub, Scope, Stream } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import {
  ProviderService,
  type ProviderServiceShape,
} from "../../provider/Services/ProviderService.ts";
import { ThreadProgressTrackerLive } from "./ThreadProgressTracker.ts";
import { ThreadProgressTracker } from "../Services/ThreadProgressTracker.ts";

const asThreadId = (value: string): ThreadId => ThreadId.makeUnsafe(value);
const asTurnId = (value: string): TurnId => TurnId.makeUnsafe(value);

function createProviderServiceHarness() {
  const runtimeEventPubSub = Effect.runSync(PubSub.unbounded<ProviderRuntimeEvent>());
  const unsupported = () => Effect.die(new Error("Unsupported provider call in test")) as never;

  const service: ProviderServiceShape = {
    startSession: () => unsupported(),
    sendTurn: () => unsupported(),
    interruptTurn: () => unsupported(),
    respondToRequest: () => unsupported(),
    respondToUserInput: () => unsupported(),
    stopSession: () => unsupported(),
    listSessions: () => Effect.succeed([]),
    getCapabilities: () => Effect.succeed({ sessionModelSwitch: "in-session" }),
    rollbackConversation: () => unsupported(),
    get streamEvents() {
      return Stream.fromPubSub(runtimeEventPubSub);
    },
  };

  let eventIndex = 0;
  const emit = (event: unknown): void => {
    eventIndex += 1;
    const eventRecord = event as Record<string, unknown>;
    Effect.runSync(
      PubSub.publish(runtimeEventPubSub, {
        ...eventRecord,
        eventId: EventId.makeUnsafe(`progress-event-${eventIndex}`),
        provider: "codex",
      } as ProviderRuntimeEvent),
    );
  };

  return { emit, service };
}

type ScopeCloseable =
  ReturnType<typeof Scope.make> extends Effect.Effect<infer A, any, any> ? A : never;

async function waitForSnapshot(
  runtime: ManagedRuntime.ManagedRuntime<ThreadProgressTracker, never>,
  threadId: ThreadId,
  assertion: (snapshot: Awaited<ReturnType<typeof readTrackerSnapshot>>) => void,
): Promise<void> {
  const startedAt = Date.now();
  for (;;) {
    const snapshot = await readTrackerSnapshot(runtime, threadId);
    try {
      assertion(snapshot);
      return;
    } catch (error) {
      if (Date.now() - startedAt >= 1_000) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

async function readTrackerSnapshot(
  runtime: ManagedRuntime.ManagedRuntime<ThreadProgressTracker, never>,
  threadId: ThreadId,
) {
  const tracker = await runtime.runPromise(Effect.service(ThreadProgressTracker));
  const snapshotMap = await runtime.runPromise(tracker.getSnapshot());
  return snapshotMap[threadId] ?? null;
}

describe("ThreadProgressTracker", () => {
  let runtime: ManagedRuntime.ManagedRuntime<ThreadProgressTracker, never> | null = null;
  let scope: ScopeCloseable | null = null;

  afterEach(async () => {
    if (scope) {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
    if (runtime) {
      await runtime.dispose();
    }
    runtime = null;
    scope = null;
  });

  async function createHarness() {
    const provider = createProviderServiceHarness();
    runtime = ManagedRuntime.make(
      Layer.empty.pipe(
        Layer.provideMerge(ThreadProgressTrackerLive),
        Layer.provideMerge(Layer.succeed(ProviderService, provider.service)),
      ),
    );
    const tracker = await runtime.runPromise(Effect.service(ThreadProgressTracker));
    scope = await Effect.runPromise(Scope.make("sequential"));
    await Effect.runPromise(tracker.start().pipe(Scope.provide(scope)));
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { provider, tracker };
  }

  it("marks a started turn as agent_running", async () => {
    const { provider } = await createHarness();
    const threadId = asThreadId("thread-agent-running");
    const turnId = asTurnId("turn-1");

    provider.emit({
      type: "turn.started",
      createdAt: "2026-04-12T10:00:00.000Z",
      threadId,
      turnId,
      payload: {
        cwd: "/repo",
        model: "gpt-5-codex",
      },
    });

    await waitForSnapshot(runtime!, threadId, (snapshot) => {
      expect(snapshot).toMatchObject({
        phase: "agent_running",
        activeTurnId: turnId,
      });
    });
  });

  it("marks approval requests as waiting_approval", async () => {
    const { provider } = await createHarness();
    const threadId = asThreadId("thread-waiting-approval");
    const turnId = asTurnId("turn-approval");

    provider.emit({
      type: "turn.started",
      createdAt: "2026-04-12T10:00:00.000Z",
      threadId,
      turnId,
      payload: {
        cwd: "/repo",
        model: "gpt-5-codex",
      },
    });
    provider.emit({
      type: "request.opened",
      createdAt: "2026-04-12T10:00:01.000Z",
      threadId,
      turnId,
      payload: {
        requestType: "command",
        detail: "Need approval for command.",
      },
    });

    await waitForSnapshot(runtime!, threadId, (snapshot) => {
      expect(snapshot).toMatchObject({
        phase: "waiting_approval",
        activeTurnId: turnId,
      });
    });
  });

  it("marks user input requests as waiting_user_input", async () => {
    const { provider } = await createHarness();
    const threadId = asThreadId("thread-waiting-input");
    const turnId = asTurnId("turn-input");

    provider.emit({
      type: "user-input.requested",
      createdAt: "2026-04-12T10:00:00.000Z",
      threadId,
      turnId,
      payload: {
        prompt: "Choose option",
      },
    });

    await waitForSnapshot(runtime!, threadId, (snapshot) => {
      expect(snapshot).toMatchObject({
        phase: "waiting_user_input",
        activeTurnId: turnId,
      });
    });
  });

  it("marks completed turns without pending post-run work as ready", async () => {
    const { provider } = await createHarness();
    const threadId = asThreadId("thread-ready");
    const turnId = asTurnId("turn-ready");

    provider.emit({
      type: "turn.started",
      createdAt: "2026-04-12T10:00:00.000Z",
      threadId,
      turnId,
      payload: {
        cwd: "/repo",
        model: "gpt-5-codex",
      },
    });
    provider.emit({
      type: "turn.completed",
      createdAt: "2026-04-12T10:00:01.000Z",
      threadId,
      turnId,
      payload: {
        state: "completed",
      },
    });

    await waitForSnapshot(runtime!, threadId, (snapshot) => {
      expect(snapshot).toMatchObject({
        phase: "ready",
        activeTurnId: null,
      });
    });
  });

  it("marks post-run stages as post_processing and terminal failures as error", async () => {
    const { tracker } = await createHarness();
    const threadId = asThreadId("thread-post-run");
    const turnId = asTurnId("turn-post-run");

    await runtime!.runPromise(
      tracker.markPostRunStageStart({
        threadId,
        turnId,
        stage: "quality_gate",
        updatedAt: "2026-04-12T10:00:00.000Z",
      }),
    );

    await waitForSnapshot(runtime!, threadId, (snapshot) => {
      expect(snapshot).toMatchObject({
        phase: "post_processing",
        activeTurnId: turnId,
        postRunStages: ["quality_gate"],
        statusMessage: "Agent finished. Running quality gate.",
      });
    });

    await runtime!.runPromise(
      tracker.markPostRunStageEnd({
        threadId,
        turnId: null,
        stage: "quality_gate",
        updatedAt: "2026-04-12T10:00:01.000Z",
        fallbackPhase: "error",
        statusMessage: "Quality gate failed. Fix reported issues.",
      }),
    );

    await waitForSnapshot(runtime!, threadId, (snapshot) => {
      expect(snapshot).toMatchObject({
        phase: "error",
        activeTurnId: null,
        postRunStages: [],
        statusMessage: "Quality gate failed. Fix reported issues.",
      });
    });
  });

  it("does not treat running with no active turn as agent_running", async () => {
    const { provider } = await createHarness();
    const threadId = asThreadId("thread-recovering");

    provider.emit({
      type: "session.state.changed",
      createdAt: "2026-04-12T10:00:00.000Z",
      threadId,
      payload: {
        state: "running",
      },
    });

    await waitForSnapshot(runtime!, threadId, (snapshot) => {
      expect(snapshot).toMatchObject({
        phase: "recovering",
        activeTurnId: null,
      });
    });
  });
});
