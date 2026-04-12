import {
  EventId,
  RuntimeItemId,
  RuntimeTaskId,
  type ProviderRuntimeEvent,
  type ProviderSendTurnInput,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import {
  resolveCliAgentCommand,
  type CliAgentCommandSettings,
  type ResolvedCliAgentCommand,
} from "@t3tools/shared/cliAgentCommand";
import { normalizeCliAgentTerminalOutput } from "@t3tools/shared/terminalText";
import { Effect, Fiber } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { spawnAndCollect, type CommandResult } from "../providerSnapshot";
import { ProviderAdapterValidationError } from "../Errors.ts";
import type {
  CliAgentAdapterConfig,
  CliAgentSessionContext,
  CliAgentProvider,
} from "./CliAgentAdapterRuntime";

type OfferRuntimeEvent = (event: ProviderRuntimeEvent) => Effect.Effect<boolean>;

interface CliAgentOperationBase {
  readonly config: CliAgentAdapterConfig;
  readonly offer: OfferRuntimeEvent;
}

interface CliAgentTurnInput extends CliAgentOperationBase {
  readonly spawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly context: CliAgentSessionContext;
  readonly input: ProviderSendTurnInput;
  readonly turnId: TurnId;
  readonly commandSettings: CliAgentCommandSettings;
  readonly completeFailure: (message: string) => Effect.Effect<void>;
}

interface CliAgentTurnResultInput extends CliAgentOperationBase {
  readonly context: CliAgentSessionContext;
  readonly turnId: TurnId;
  readonly taskId: RuntimeTaskId;
  readonly itemId: RuntimeItemId;
  readonly result: CommandResult;
  readonly completeFailure: (message: string) => Effect.Effect<void>;
}

interface StopSessionInput extends CliAgentOperationBase {
  readonly sessions: Map<ThreadId, CliAgentSessionContext>;
  readonly context: CliAgentSessionContext;
  readonly emitExitEvent: boolean;
}

function nowIso(): string {
  return new Date().toISOString();
}

function eventId(): EventId {
  return EventId.makeUnsafe(crypto.randomUUID());
}

function asTaskId(value: string): RuntimeTaskId {
  return RuntimeTaskId.makeUnsafe(value);
}

function asItemId(value: string): RuntimeItemId {
  return RuntimeItemId.makeUnsafe(value);
}

function trimOutput(value: string): string {
  return normalizeCliAgentTerminalOutput(value).trim();
}

function toMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.length > 0 ? cause.message : fallback;
}

const runCommand = Effect.fn("runCommand")(function* (input: {
  readonly commandSpec: ResolvedCliAgentCommand;
}) {
  const command = ChildProcess.make(input.commandSpec.command, [...input.commandSpec.args], {
    shell: input.commandSpec.shell,
    ...(input.commandSpec.cwd ? { cwd: input.commandSpec.cwd } : {}),
  });
  return yield* spawnAndCollect(input.commandSpec.command, command);
});

export const runCliAgentTurn = Effect.fn("runCliAgentTurn")(function* (input: CliAgentTurnInput) {
  const prompt = input.input.input?.trim() ?? "";
  const model =
    input.input.modelSelection?.provider === input.config.provider
      ? input.input.modelSelection.model
      : undefined;
  const resolveCommand = (args: ReadonlyArray<string>) =>
    resolveCliAgentCommand(
      input.commandSettings,
      args,
      input.context.session.cwd ? { cwd: input.context.session.cwd } : {},
    );
  const taskId = asTaskId(`cli:${input.turnId}`);
  const itemId = asItemId(`assistant:${input.turnId}`);

  yield* emitTaskStarted(input, taskId);
  const preparationCommands = input.config.buildPreparationArgs?.({ model }) ?? [];
  for (const args of preparationCommands) {
    const preparation = yield* runCommand({
      commandSpec: resolveCommand(args),
    }).pipe(
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, input.spawner),
      Effect.result,
    );
    if (input.context.stopped) return;
    if (preparation._tag === "Failure") {
      yield* input.completeFailure(
        toMessage(preparation.failure, `${input.config.displayName} CLI turn failed.`),
      );
      return;
    }
    if (preparation.success.code !== 0) {
      const detail = trimOutput(`${preparation.success.stdout}\n${preparation.success.stderr}`);
      yield* input.completeFailure(
        detail
          ? `${input.config.displayName} CLI model selection failed. ${detail}`
          : `${input.config.displayName} CLI model selection failed.`,
      );
      return;
    }
  }
  const result = yield* runCommand({
    commandSpec: resolveCommand(input.config.buildTurnArgs({ prompt })),
  }).pipe(
    Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, input.spawner),
    Effect.result,
  );

  if (input.context.stopped) return;
  if (result._tag === "Failure") {
    yield* input.completeFailure(
      toMessage(result.failure, `${input.config.displayName} CLI turn failed.`),
    );
    return;
  }
  yield* handleCommandResult({ ...input, taskId, itemId, result: result.success });
});

function emitTaskStarted(input: CliAgentOperationBase & CliAgentTurnInput, taskId: RuntimeTaskId) {
  return input.offer({
    type: "task.started",
    eventId: eventId(),
    provider: input.config.provider,
    createdAt: nowIso(),
    threadId: input.context.session.threadId,
    turnId: input.turnId,
    payload: {
      taskId,
      taskType: "cli-agent",
      description: `Running ${input.config.displayName} CLI.`,
    },
  });
}

const handleCommandResult = Effect.fn("handleCommandResult")(function* (
  input: CliAgentTurnResultInput,
) {
  const stdout = trimOutput(input.result.stdout);
  const stderr = trimOutput(input.result.stderr);
  const output = stdout || stderr;
  if (input.result.code !== 0) {
    yield* input.completeFailure(
      output
        ? `${input.config.displayName} CLI exited with code ${input.result.code}. ${output}`
        : `${input.config.displayName} CLI exited with code ${input.result.code}.`,
    );
    return;
  }
  yield* completeTurnSuccess(input, output);
});

const completeTurnSuccess = Effect.fn("completeTurnSuccess")(function* (
  input: CliAgentTurnResultInput,
  output: string,
) {
  const completedAt = nowIso();
  if (output.length > 0) {
    yield* emitAssistantOutput(input, output, completedAt);
  }
  yield* emitTaskCompleted(input, output, completedAt);
  input.context.turns.push({
    id: input.turnId,
    items: output ? [{ type: "assistant_message", text: output }] : [],
  });
  input.context.activeTurnFiber = undefined;
  input.context.session = {
    ...input.context.session,
    status: "ready",
    activeTurnId: undefined,
    lastError: undefined,
    updatedAt: completedAt,
  };
  yield* input.offer({
    type: "turn.completed",
    eventId: eventId(),
    provider: input.config.provider,
    createdAt: completedAt,
    threadId: input.context.session.threadId,
    turnId: input.turnId,
    payload: { state: "completed" },
  });
});

function emitAssistantOutput(input: CliAgentTurnResultInput, output: string, completedAt: string) {
  return Effect.all(
    [
      input.offer({
        type: "content.delta",
        eventId: eventId(),
        provider: input.config.provider,
        createdAt: completedAt,
        threadId: input.context.session.threadId,
        turnId: input.turnId,
        itemId: input.itemId,
        payload: { streamKind: "assistant_text", delta: output },
      }),
      input.offer({
        type: "item.completed",
        eventId: eventId(),
        provider: input.config.provider,
        createdAt: completedAt,
        threadId: input.context.session.threadId,
        turnId: input.turnId,
        itemId: input.itemId,
        payload: { itemType: "assistant_message", status: "completed", detail: output },
      }),
    ],
    { discard: true },
  );
}

function emitTaskCompleted(input: CliAgentTurnResultInput, output: string, completedAt: string) {
  return input.offer({
    type: "task.completed",
    eventId: eventId(),
    provider: input.config.provider,
    createdAt: completedAt,
    threadId: input.context.session.threadId,
    turnId: input.turnId,
    payload: {
      taskId: input.taskId,
      status: "completed",
      ...(output ? { summary: output.slice(0, 400) } : {}),
    },
  });
}

export const completeCliAgentTurnFailure = Effect.fn("completeCliAgentTurnFailure")(function* (
  input: CliAgentOperationBase & {
    readonly context: CliAgentSessionContext;
    readonly turnId: TurnId;
    readonly message: string;
  },
) {
  const completedAt = nowIso();
  input.context.activeTurnFiber = undefined;
  input.context.session = {
    ...input.context.session,
    status: "error",
    activeTurnId: undefined,
    lastError: input.message,
    updatedAt: completedAt,
  };
  yield* input.offer({
    type: "runtime.error",
    eventId: eventId(),
    provider: input.config.provider,
    createdAt: completedAt,
    threadId: input.context.session.threadId,
    turnId: input.turnId,
    payload: { message: input.message, class: "provider_error" },
  });
  yield* input.offer({
    type: "turn.completed",
    eventId: eventId(),
    provider: input.config.provider,
    createdAt: completedAt,
    threadId: input.context.session.threadId,
    turnId: input.turnId,
    payload: { state: "failed", errorMessage: input.message },
  });
});

export function applyCliAgentRollback(
  config: Pick<CliAgentAdapterConfig, "provider">,
  context: CliAgentSessionContext,
  threadId: ThreadId,
  numTurns: number,
) {
  if (!Number.isInteger(numTurns) || numTurns < 1) {
    return Effect.fail(
      new ProviderAdapterValidationError({
        provider: config.provider,
        operation: "rollbackThread",
        issue: "numTurns must be an integer >= 1.",
      }),
    );
  }
  const nextLength = Math.max(0, context.turns.length - numTurns);
  context.turns.splice(nextLength);
  return Effect.succeed({ threadId, turns: [...context.turns] });
}

export const stopCliAgentSession = Effect.fn("stopCliAgentSession")(function* (
  input: StopSessionInput,
) {
  if (input.context.stopped) return;
  input.context.stopped = true;
  input.sessions.delete(input.context.session.threadId);
  if (input.context.activeTurnFiber) {
    yield* Fiber.interrupt(input.context.activeTurnFiber);
  }
  input.context.session = {
    ...input.context.session,
    status: "closed",
    activeTurnId: undefined,
    updatedAt: nowIso(),
  };
  if (input.emitExitEvent) {
    yield* emitSessionExited(input);
  }
});

function emitSessionExited(input: StopSessionInput) {
  return input.offer({
    type: "session.exited",
    eventId: eventId(),
    provider: input.config.provider as CliAgentProvider,
    threadId: input.context.session.threadId,
    createdAt: nowIso(),
    payload: {
      reason: `${input.config.displayName} session stopped.`,
      exitKind: "graceful",
      recoverable: true,
    },
  });
}
