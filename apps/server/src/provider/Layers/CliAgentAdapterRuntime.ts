import {
  ApprovalRequestId,
  EventId,
  type ProviderApprovalDecision,
  type ProviderKind,
  type ProviderRuntimeEvent,
  type ProviderSendTurnInput,
  type ProviderSession,
  type ProviderSessionStartInput,
  type ProviderTurnStartResult,
  type ProviderUserInputAnswers,
  type ServerSettings,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import type { CliAgentCommandSettings } from "@t3tools/shared/cliAgentCommand";
import { Effect, Fiber, Queue, Stream } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";

import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from "../Errors.ts";
import type { ProviderAdapterShape, ProviderThreadTurnSnapshot } from "../Services/ProviderAdapter";
import type { ServerSettingsShape } from "../../serverSettings";
import {
  applyCliAgentRollback,
  completeCliAgentTurnFailure,
  runCliAgentTurn,
  stopCliAgentSession,
} from "./CliAgentAdapterOps";

export type CliAgentProvider = Extract<ProviderKind, "kiro" | "amazonQ">;

export interface CliAgentAdapterConfig {
  readonly provider: CliAgentProvider;
  readonly displayName: string;
  readonly selectCommandSettings: (settings: ServerSettings) => CliAgentCommandSettings;
  readonly buildTurnArgs: (input: {
    readonly prompt: string;
    readonly model: string | undefined;
  }) => ReadonlyArray<string>;
}

export interface CliAgentSessionContext {
  session: ProviderSession;
  activeTurnFiber: Fiber.Fiber<void, never> | undefined;
  turns: Array<ProviderThreadTurnSnapshot>;
  stopped: boolean;
}

export interface CliAgentRuntimeServices {
  readonly serverSettings: ServerSettingsShape;
  readonly spawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly runtimeEventQueue: Queue.Queue<ProviderRuntimeEvent>;
  readonly sessions: Map<ThreadId, CliAgentSessionContext>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function eventId(): EventId {
  return EventId.makeUnsafe(crypto.randomUUID());
}

function toMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.length > 0 ? cause.message : fallback;
}

export class CliAgentAdapterRuntime {
  constructor(
    private readonly config: CliAgentAdapterConfig,
    private readonly services: CliAgentRuntimeServices,
  ) {}

  toAdapter(): ProviderAdapterShape<ProviderAdapterError> {
    return {
      provider: this.config.provider,
      capabilities: { sessionModelSwitch: "unsupported" },
      startSession: this.startSession.bind(this),
      sendTurn: this.sendTurn.bind(this),
      interruptTurn: this.interruptTurn.bind(this),
      respondToRequest: this.respondToRequest.bind(this),
      respondToUserInput: this.respondToUserInput.bind(this),
      stopSession: this.stopSession.bind(this),
      listSessions: this.listSessions.bind(this),
      hasSession: this.hasSession.bind(this),
      readThread: this.readThread.bind(this),
      rollbackThread: this.rollbackThread.bind(this),
      stopAll: this.stopAll.bind(this),
      streamEvents: Stream.fromQueue(this.services.runtimeEventQueue),
    };
  }

  shutdown() {
    return this.stopAllInternal(false).pipe(
      Effect.tap(() => Queue.shutdown(this.services.runtimeEventQueue)),
    );
  }

  startSession(input: ProviderSessionStartInput) {
    const services = this.services;
    const validateStartSession = this.validateStartSession.bind(this);
    const createSessionContext = this.createSessionContext.bind(this);
    const emitSessionStarted = this.emitSessionStarted.bind(this);
    const emitSessionConfigured = this.emitSessionConfigured.bind(this);
    const emitSessionReady = this.emitSessionReady.bind(this);
    return Effect.gen(function* () {
      yield* validateStartSession(input);
      const context = createSessionContext(input);
      services.sessions.set(input.threadId, context);
      yield* emitSessionStarted(input, context);
      yield* emitSessionConfigured(input, context);
      yield* emitSessionReady(input.threadId);
      return { ...context.session };
    });
  }

  sendTurn(
    input: ProviderSendTurnInput,
  ): Effect.Effect<ProviderTurnStartResult, ProviderAdapterError> {
    const services = this.services;
    const requireSession = this.requireSession.bind(this);
    const validateTurnStart = this.validateTurnStart.bind(this);
    const modelFromTurnInput = this.modelFromTurnInput.bind(this);
    const markTurnRunning = this.markTurnRunning.bind(this);
    const emitTurnStarted = this.emitTurnStarted.bind(this);
    const forkTurn = this.forkTurn.bind(this);
    const turnStartResult = this.turnStartResult.bind(this);
    return Effect.gen(function* () {
      const context = yield* requireSession(input.threadId);
      yield* validateTurnStart(context);
      const settings = yield* services.serverSettings.getSettings.pipe(Effect.orDie);
      const turnId = TurnId.makeUnsafe(crypto.randomUUID());
      const model = modelFromTurnInput(input);
      markTurnRunning(context, turnId, model);
      yield* emitTurnStarted(context, turnId, model);
      context.activeTurnFiber = yield* forkTurn(context, input, turnId, settings);
      return turnStartResult(context, turnId);
    });
  }

  interruptTurn(threadId: ThreadId) {
    const provider = this.config.provider;
    const requireSession = this.requireSession.bind(this);
    const markTurnReady = this.markTurnReady.bind(this);
    const offer = this.offer.bind(this);
    return Effect.gen(function* () {
      const context = yield* requireSession(threadId);
      const turnId = context.session.activeTurnId;
      if (!context.activeTurnFiber || !turnId) return;
      yield* Fiber.interrupt(context.activeTurnFiber);
      markTurnReady(context);
      yield* offer({
        type: "turn.aborted",
        eventId: eventId(),
        provider,
        createdAt: nowIso(),
        threadId,
        turnId,
        payload: { reason: "Interrupted by user." },
      });
    });
  }

  respondToRequest(
    _threadId: ThreadId,
    _requestId: ApprovalRequestId,
    _decision: ProviderApprovalDecision,
  ) {
    return Effect.fail(this.unsupportedRequest("item/requestApproval/decision"));
  }

  respondToUserInput(
    _threadId: ThreadId,
    _requestId: ApprovalRequestId,
    _answers: ProviderUserInputAnswers,
  ) {
    return Effect.fail(this.unsupportedRequest("item/tool/respondToUserInput"));
  }

  stopSession(threadId: ThreadId) {
    return this.requireSession(threadId).pipe(
      Effect.flatMap((context) => this.stopSessionInternal(context, true)),
    );
  }

  listSessions() {
    return Effect.sync(() =>
      Array.from(this.services.sessions.values())
        .filter((context) => !context.stopped)
        .map((context) => Object.assign({}, context.session)),
    );
  }

  hasSession(threadId: ThreadId) {
    return Effect.sync(() => {
      const context = this.services.sessions.get(threadId);
      return context !== undefined && !context.stopped;
    });
  }

  readThread(threadId: ThreadId) {
    return this.requireSession(threadId).pipe(
      Effect.map((context) => ({
        threadId,
        turns: [...context.turns],
      })),
    );
  }

  rollbackThread(threadId: ThreadId, numTurns: number) {
    return this.requireSession(threadId).pipe(
      Effect.flatMap((context) => this.applyRollback(context, threadId, numTurns)),
    );
  }

  stopAll() {
    return this.stopAllInternal(true);
  }

  private offer(event: ProviderRuntimeEvent) {
    return Queue.offer(this.services.runtimeEventQueue, event);
  }

  private requireSession(
    threadId: ThreadId,
  ): Effect.Effect<CliAgentSessionContext, ProviderAdapterSessionNotFoundError> {
    const context = this.services.sessions.get(threadId);
    if (!context || context.stopped) {
      return Effect.fail(
        new ProviderAdapterSessionNotFoundError({ provider: this.config.provider, threadId }),
      );
    }
    return Effect.succeed(context);
  }

  private validateStartSession(input: ProviderSessionStartInput) {
    if (input.provider !== undefined && input.provider !== this.config.provider) {
      return Effect.fail(
        new ProviderAdapterValidationError({
          provider: this.config.provider,
          operation: "startSession",
          issue: `Expected provider '${this.config.provider}' but received '${input.provider}'.`,
        }),
      );
    }
    return this.validateRuntimeMode("startSession", input.runtimeMode);
  }

  private validateRuntimeMode(operation: string, runtimeMode: ProviderSession["runtimeMode"]) {
    if (runtimeMode !== "approval-required") return Effect.void;
    return Effect.fail(
      new ProviderAdapterValidationError({
        provider: this.config.provider,
        operation,
        issue: `${this.config.displayName} is supported only in full-access mode because its CLI does not expose DGCoder-compatible approval callbacks.`,
      }),
    );
  }

  private createSessionContext(input: ProviderSessionStartInput): CliAgentSessionContext {
    const startedAt = nowIso();
    const model = this.modelFromStartInput(input);
    const session: ProviderSession = {
      threadId: input.threadId,
      provider: this.config.provider,
      status: "ready",
      runtimeMode: input.runtimeMode,
      ...(input.cwd ? { cwd: input.cwd } : {}),
      ...(model ? { model } : {}),
      resumeCursor: { provider: this.config.provider, threadId: input.threadId },
      createdAt: startedAt,
      updatedAt: startedAt,
    };
    return { session, activeTurnFiber: undefined, turns: [], stopped: false };
  }

  private modelFromStartInput(input: ProviderSessionStartInput): string | undefined {
    return input.modelSelection?.provider === this.config.provider
      ? input.modelSelection.model
      : undefined;
  }

  private modelFromTurnInput(input: ProviderSendTurnInput): string | undefined {
    return input.modelSelection?.provider === this.config.provider
      ? input.modelSelection.model
      : undefined;
  }

  private emitSessionStarted(input: ProviderSessionStartInput, context: CliAgentSessionContext) {
    return this.offer({
      type: "session.started",
      eventId: eventId(),
      ...this.sessionEventBase(context),
      payload: input.resumeCursor !== undefined ? { resume: input.resumeCursor } : {},
    });
  }

  private emitSessionConfigured(input: ProviderSessionStartInput, context: CliAgentSessionContext) {
    return this.offer({
      type: "session.configured",
      eventId: eventId(),
      ...this.sessionEventBase(context),
      payload: {
        config: {
          ...(input.cwd ? { cwd: input.cwd } : {}),
          ...(context.session.model ? { model: context.session.model } : {}),
        },
      },
    });
  }

  private emitSessionReady(threadId: ThreadId) {
    return this.offer({
      type: "session.state.changed",
      eventId: eventId(),
      provider: this.config.provider,
      createdAt: nowIso(),
      threadId,
      payload: { state: "ready" },
    });
  }

  private sessionEventBase(context: CliAgentSessionContext) {
    return {
      provider: this.config.provider,
      threadId: context.session.threadId,
      createdAt: nowIso(),
    };
  }

  private validateTurnStart(context: CliAgentSessionContext) {
    if (context.session.runtimeMode === "approval-required") {
      return this.validateRuntimeMode("sendTurn", context.session.runtimeMode);
    }
    if (!context.activeTurnFiber) return Effect.void;
    return Effect.fail(
      new ProviderAdapterRequestError({
        provider: this.config.provider,
        method: "turn/start",
        detail: `${this.config.displayName} already has a turn in progress for this thread.`,
      }),
    );
  }

  private markTurnRunning(
    context: CliAgentSessionContext,
    turnId: TurnId,
    model: string | undefined,
  ) {
    context.session = {
      ...context.session,
      status: "running",
      activeTurnId: turnId,
      ...(model ? { model } : {}),
      updatedAt: nowIso(),
    };
  }

  private markTurnReady(context: CliAgentSessionContext) {
    context.activeTurnFiber = undefined;
    context.session = {
      ...context.session,
      status: "ready",
      activeTurnId: undefined,
      updatedAt: nowIso(),
    };
  }

  private emitTurnStarted(
    context: CliAgentSessionContext,
    turnId: TurnId,
    model: string | undefined,
  ) {
    return this.offer({
      type: "turn.started",
      eventId: eventId(),
      provider: this.config.provider,
      createdAt: nowIso(),
      threadId: context.session.threadId,
      turnId,
      payload: model ? { model } : {},
    });
  }

  private forkTurn(
    context: CliAgentSessionContext,
    input: ProviderSendTurnInput,
    turnId: TurnId,
    settings: ServerSettings,
  ) {
    const commandSettings = this.config.selectCommandSettings(settings);
    return runCliAgentTurn({
      config: this.config,
      spawner: this.services.spawner,
      offer: (event) => this.offer(event),
      context,
      input,
      turnId,
      commandSettings,
      completeFailure: (message) => this.completeTurnFailure(context, turnId, message),
    }).pipe(
      Effect.catchCause((cause) =>
        this.completeTurnFailure(
          context,
          turnId,
          toMessage(cause, `${this.config.displayName} CLI turn failed.`),
        ),
      ),
      Effect.forkDetach,
    );
  }

  private completeTurnFailure(context: CliAgentSessionContext, turnId: TurnId, message: string) {
    return completeCliAgentTurnFailure({
      config: this.config,
      offer: (event) => this.offer(event),
      context,
      turnId,
      message,
    });
  }

  private applyRollback(context: CliAgentSessionContext, threadId: ThreadId, numTurns: number) {
    return applyCliAgentRollback(this.config, context, threadId, numTurns);
  }

  private stopAllInternal(emitExitEvent: boolean) {
    return Effect.forEach(
      Array.from(this.services.sessions.values()),
      (context) => this.stopSessionInternal(context, emitExitEvent),
      { discard: true },
    );
  }

  private stopSessionInternal(context: CliAgentSessionContext, emitExitEvent: boolean) {
    return stopCliAgentSession({
      config: this.config,
      offer: (event) => this.offer(event),
      sessions: this.services.sessions,
      context,
      emitExitEvent,
    });
  }

  private unsupportedRequest(method: string) {
    return new ProviderAdapterRequestError({
      provider: this.config.provider,
      method,
      detail: `${this.config.displayName} does not expose DGCoder-compatible interactive request callbacks.`,
    });
  }

  private turnStartResult(
    context: CliAgentSessionContext,
    turnId: TurnId,
  ): ProviderTurnStartResult {
    return {
      threadId: context.session.threadId,
      turnId,
      ...(context.session.resumeCursor !== undefined
        ? { resumeCursor: context.session.resumeCursor }
        : {}),
    };
  }
}
