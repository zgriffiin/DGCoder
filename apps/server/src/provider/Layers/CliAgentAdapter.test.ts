import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { Effect, Layer, Sink, Stream } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import { ThreadId } from "@t3tools/contracts";

import { ServerSettingsService } from "../../serverSettings";
import { ProviderAdapterValidationError } from "../Errors";
import { AmazonQAdapter } from "../Services/AmazonQAdapter";
import { KiroAdapter } from "../Services/KiroAdapter";
import { AmazonQAdapterLive, KiroAdapterLive } from "./CliAgentAdapter";

const encoder = new TextEncoder();

function mockHandle(result: { stdout: string; stderr: string; code: number }) {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(result.code)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    stdin: Sink.drain,
    stdout: Stream.make(encoder.encode(result.stdout)),
    stderr: Stream.make(encoder.encode(result.stderr)),
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });
}

function mockCommandSpawnerLayer(
  handler: (
    command: string,
    args: ReadonlyArray<string>,
  ) => { stdout: string; stderr: string; code: number },
) {
  return Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) => {
      const cmd = command as unknown as { command: string; args: ReadonlyArray<string> };
      return Effect.succeed(mockHandle(handler(cmd.command, cmd.args)));
    }),
  );
}

const THREAD_ID = ThreadId.makeUnsafe("thread-cli-agent-1");

describe("CliAgentAdapter approval mode", () => {
  it.effect("fails fast for approval-required Kiro sessions", () =>
    Effect.gen(function* () {
      const adapter = yield* KiroAdapter;
      const result = yield* adapter
        .startSession({
          threadId: THREAD_ID,
          provider: "kiro",
          runtimeMode: "approval-required",
        })
        .pipe(Effect.result);

      assert.equal(result._tag, "Failure");
      if (result._tag !== "Failure") {
        return;
      }
      assert.deepEqual(
        result.failure,
        new ProviderAdapterValidationError({
          provider: "kiro",
          operation: "startSession",
          issue:
            "Kiro is supported only in full-access mode because its CLI does not expose DGCoder-compatible approval callbacks.",
        }),
      );
    }).pipe(
      Effect.provide(
        KiroAdapterLive.pipe(
          Layer.provideMerge(ServerSettingsService.layerTest()),
          Layer.provideMerge(mockCommandSpawnerLayer(() => ({ stdout: "", stderr: "", code: 0 }))),
        ),
      ),
    ),
  );

  it.effect("fails fast for approval-required Amazon Q sessions", () =>
    Effect.gen(function* () {
      const adapter = yield* AmazonQAdapter;
      const result = yield* adapter
        .startSession({
          threadId: THREAD_ID,
          provider: "amazonQ",
          runtimeMode: "approval-required",
        })
        .pipe(Effect.result);

      assert.equal(result._tag, "Failure");
      if (result._tag !== "Failure") {
        return;
      }
      assert.deepEqual(
        result.failure,
        new ProviderAdapterValidationError({
          provider: "amazonQ",
          operation: "startSession",
          issue:
            "Amazon Q is supported only in full-access mode because its CLI does not expose DGCoder-compatible approval callbacks.",
        }),
      );
    }).pipe(
      Effect.provide(
        AmazonQAdapterLive.pipe(
          Layer.provideMerge(ServerSettingsService.layerTest()),
          Layer.provideMerge(mockCommandSpawnerLayer(() => ({ stdout: "", stderr: "", code: 0 }))),
        ),
      ),
    ),
  );
});

describe("CliAgentAdapter Kiro chat command", () => {
  it.effect("runs Kiro turns through the non-interactive trusted chat command", () => {
    const invocations: Array<{ command: string; args: ReadonlyArray<string> }> = [];

    return Effect.gen(function* () {
      const adapter = yield* KiroAdapter;

      yield* adapter.startSession({
        threadId: THREAD_ID,
        provider: "kiro",
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({
        threadId: THREAD_ID,
        input: "Inspect the workspace",
        modelSelection: {
          provider: "kiro",
          model: "default",
        },
      });
      const events = yield* adapter.streamEvents.pipe(
        Stream.takeUntil((event) => event.type === "turn.completed"),
        Stream.runCollect,
        Effect.map((chunk) => Array.from(chunk)),
        Effect.timeout("2 seconds"),
      );

      assert.deepEqual(invocations, [
        {
          command: "kiro-cli",
          args: ["chat", "--no-interactive", "--trust-all-tools", "Inspect the workspace"],
        },
      ]);
      assert.equal(events.at(-1)?.type, "turn.completed");
      assert.deepEqual(events.find((event) => event.type === "content.delta")?.payload, {
        streamKind: "assistant_text",
        delta: "Kiro response",
      });
    }).pipe(
      Effect.provide(
        KiroAdapterLive.pipe(
          Layer.provideMerge(
            ServerSettingsService.layerTest({
              providers: {
                kiro: {
                  executionMode: "host",
                },
              },
            }),
          ),
          Layer.provideMerge(
            mockCommandSpawnerLayer((command, args) => {
              invocations.push({ command, args: [...args] });
              return { stdout: "Kiro response\n", stderr: "", code: 0 };
            }),
          ),
        ),
      ),
    );
  });

  it.effect("runs Kiro turns through WSL when configured", () => {
    const invocations: Array<{ command: string; args: ReadonlyArray<string> }> = [];
    const wslCommand = process.platform === "win32" ? "wsl.exe" : "wsl";
    const cwd = process.platform === "win32" ? "C:\\Users\\dgriffin3\\DGCoder" : "/repo/project";
    const wslCwd =
      process.platform === "win32" ? "/mnt/c/Users/dgriffin3/DGCoder" : "/repo/project";

    return Effect.gen(function* () {
      const adapter = yield* KiroAdapter;

      yield* adapter.startSession({
        threadId: ThreadId.makeUnsafe("thread-cli-agent-kiro-wsl"),
        provider: "kiro",
        runtimeMode: "full-access",
        cwd,
      });
      yield* adapter.sendTurn({
        threadId: ThreadId.makeUnsafe("thread-cli-agent-kiro-wsl"),
        input: "Inspect the workspace",
        modelSelection: {
          provider: "kiro",
          model: "default",
        },
      });
      const events = yield* adapter.streamEvents.pipe(
        Stream.takeUntil((event) => event.type === "turn.completed"),
        Stream.runCollect,
        Effect.map((chunk) => Array.from(chunk)),
        Effect.timeout("2 seconds"),
      );

      assert.deepEqual(invocations, [
        {
          command: wslCommand,
          args: [
            "-d",
            "Ubuntu",
            "--cd",
            wslCwd,
            "--exec",
            "bash",
            "-lc",
            'exec "$@"',
            "bash",
            "kiro-cli",
            "chat",
            "--no-interactive",
            "--trust-all-tools",
            "Inspect the workspace",
          ],
        },
      ]);
      assert.equal(events.at(-1)?.type, "turn.completed");
    }).pipe(
      Effect.provide(
        KiroAdapterLive.pipe(
          Layer.provideMerge(
            ServerSettingsService.layerTest({
              providers: {
                kiro: {
                  executionMode: "wsl",
                  wslDistro: "Ubuntu",
                },
              },
            }),
          ),
          Layer.provideMerge(
            mockCommandSpawnerLayer((command, args) => {
              invocations.push({ command, args: [...args] });
              return { stdout: "Kiro response\n", stderr: "", code: 0 };
            }),
          ),
        ),
      ),
    );
  });

  it.effect("strips terminal color codes from Kiro assistant output", () =>
    Effect.gen(function* () {
      const adapter = yield* KiroAdapter;

      yield* adapter.startSession({
        threadId: ThreadId.makeUnsafe("thread-cli-agent-kiro-ansi"),
        provider: "kiro",
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({
        threadId: ThreadId.makeUnsafe("thread-cli-agent-kiro-ansi"),
        input: "Inspect the workspace",
        modelSelection: {
          provider: "kiro",
          model: "default",
        },
      });
      const events = yield* adapter.streamEvents.pipe(
        Stream.takeUntil((event) => event.type === "turn.completed"),
        Stream.runCollect,
        Effect.map((chunk) => Array.from(chunk)),
        Effect.timeout("2 seconds"),
      );

      assert.deepEqual(events.find((event) => event.type === "content.delta")?.payload, {
        streamKind: "assistant_text",
        delta: "Kiro response",
      });
      assert.deepEqual(events.find((event) => event.type === "item.completed")?.payload, {
        itemType: "assistant_message",
        status: "completed",
        detail: "Kiro response",
      });
    }).pipe(
      Effect.provide(
        KiroAdapterLive.pipe(
          Layer.provideMerge(
            ServerSettingsService.layerTest({
              providers: {
                kiro: {
                  executionMode: "host",
                },
              },
            }),
          ),
          Layer.provideMerge(
            mockCommandSpawnerLayer(() => ({
              stdout: "\x1b[38;5;14m> \x1b[0mKiro response\n",
              stderr: "",
              code: 0,
            })),
          ),
        ),
      ),
    ),
  );
});

describe("CliAgentAdapter Amazon Q chat command", () => {
  it.effect("runs Amazon Q turns through the non-interactive trusted chat command", () => {
    const invocations: Array<{ command: string; args: ReadonlyArray<string> }> = [];

    return Effect.gen(function* () {
      const adapter = yield* AmazonQAdapter;

      yield* adapter.startSession({
        threadId: ThreadId.makeUnsafe("thread-cli-agent-amazon-q"),
        provider: "amazonQ",
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({
        threadId: ThreadId.makeUnsafe("thread-cli-agent-amazon-q"),
        input: "Inspect the workspace",
        modelSelection: {
          provider: "amazonQ",
          model: "default",
        },
      });
      const events = yield* adapter.streamEvents.pipe(
        Stream.takeUntil((event) => event.type === "turn.completed"),
        Stream.runCollect,
        Effect.map((chunk) => Array.from(chunk)),
        Effect.timeout("2 seconds"),
      );

      assert.deepEqual(invocations, [
        {
          command: "q",
          args: ["chat", "--no-interactive", "--trust-all-tools", "Inspect the workspace"],
        },
      ]);
      assert.equal(events.at(-1)?.type, "turn.completed");
      assert.deepEqual(events.find((event) => event.type === "content.delta")?.payload, {
        streamKind: "assistant_text",
        delta: "Amazon Q response",
      });
    }).pipe(
      Effect.provide(
        AmazonQAdapterLive.pipe(
          Layer.provideMerge(ServerSettingsService.layerTest()),
          Layer.provideMerge(
            mockCommandSpawnerLayer((command, args) => {
              invocations.push({ command, args: [...args] });
              return { stdout: "Amazon Q response\n", stderr: "", code: 0 };
            }),
          ),
        ),
      ),
    );
  });
});
