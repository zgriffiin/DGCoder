import assert from "node:assert/strict";
import * as PlatformError from "effect/PlatformError";
import { describe, it } from "@effect/vitest";
import { Effect, Layer, Sink, Stream } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";

import { ServerSettingsService } from "../../serverSettings";
import {
  AMAZON_Q_PROVIDER_CONFIG,
  checkCliAgentProviderStatus,
  KIRO_PROVIDER_CONFIG,
} from "./CliAgentProvider";

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

function mockSpawnerLayer(
  handler: (args: ReadonlyArray<string>) => { stdout: string; stderr: string; code: number },
) {
  return Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) => {
      const cmd = command as unknown as { args: ReadonlyArray<string> };
      return Effect.succeed(mockHandle(handler(cmd.args)));
    }),
  );
}

function failingSpawnerLayer(description: string) {
  return Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make(() =>
      Effect.fail(
        PlatformError.systemError({
          _tag: "NotFound",
          module: "ChildProcess",
          method: "spawn",
          description,
        }),
      ),
    ),
  );
}

describe("checkCliAgentProviderStatus readiness", () => {
  it.effect("returns ready when Kiro is installed and authenticated", () =>
    Effect.gen(function* () {
      const status = yield* checkCliAgentProviderStatus(KIRO_PROVIDER_CONFIG);
      assert.strictEqual(status.provider, "kiro");
      assert.strictEqual(status.status, "ready");
      assert.strictEqual(status.installed, true);
      assert.strictEqual(status.version, "1.2.3");
      assert.strictEqual(status.auth.status, "authenticated");
      assert.deepStrictEqual(
        status.models.map((model) => model.slug),
        ["default"],
      );
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          ServerSettingsService.layerTest(),
          mockSpawnerLayer((args) => {
            const joined = args.join(" ");
            if (joined === "--version") return { stdout: "kiro-cli 1.2.3\n", stderr: "", code: 0 };
            if (joined === "whoami --format json")
              return { stdout: '{"authenticated":true}\n', stderr: "", code: 0 };
            throw new Error(`Unexpected args: ${joined}`);
          }),
        ),
      ),
    ),
  );

  it.effect("returns ready when Amazon Q is installed and authenticated", () =>
    Effect.gen(function* () {
      const status = yield* checkCliAgentProviderStatus(AMAZON_Q_PROVIDER_CONFIG);
      assert.strictEqual(status.provider, "amazonQ");
      assert.strictEqual(status.status, "ready");
      assert.strictEqual(status.installed, true);
      assert.strictEqual(status.version, "2.3.4");
      assert.strictEqual(status.auth.status, "authenticated");
      assert.deepStrictEqual(
        status.models.map((model) => model.slug),
        ["default"],
      );
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          ServerSettingsService.layerTest(),
          mockSpawnerLayer((args) => {
            const joined = args.join(" ");
            if (joined === "--version")
              return { stdout: "amazon-q-cli 2.3.4\n", stderr: "", code: 0 };
            if (joined === "whoami --format json")
              return { stdout: '{"authenticated":true}\n', stderr: "", code: 0 };
            throw new Error(`Unexpected args: ${joined}`);
          }),
        ),
      ),
    ),
  );
});

describe("checkCliAgentProviderStatus failure states", () => {
  it.effect("does not run fallback version commands after a missing binary result", () =>
    Effect.gen(function* () {
      const status = yield* checkCliAgentProviderStatus(KIRO_PROVIDER_CONFIG);
      assert.strictEqual(status.provider, "kiro");
      assert.strictEqual(status.status, "error");
      assert.strictEqual(status.installed, true);
      assert.match(status.message ?? "", /spawn ENOENT/);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          ServerSettingsService.layerTest(),
          mockSpawnerLayer((args) => {
            const joined = args.join(" ");
            if (joined === "--version") return { stdout: "", stderr: "spawn ENOENT", code: 1 };
            throw new Error(`Unexpected args: ${joined}`);
          }),
        ),
      ),
    ),
  );

  it.effect("returns unauthenticated when the Kiro auth probe reports no session", () =>
    Effect.gen(function* () {
      const status = yield* checkCliAgentProviderStatus(KIRO_PROVIDER_CONFIG);
      assert.strictEqual(status.provider, "kiro");
      assert.strictEqual(status.status, "error");
      assert.strictEqual(status.installed, true);
      assert.strictEqual(status.auth.status, "unauthenticated");
      assert.strictEqual(
        status.message,
        "Kiro is not authenticated. Run `kiro-cli login` and try again.",
      );
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          ServerSettingsService.layerTest(),
          mockSpawnerLayer((args) => {
            const joined = args.join(" ");
            if (joined === "--version") return { stdout: "kiro-cli 1.2.3\n", stderr: "", code: 0 };
            if (joined === "whoami --format json")
              return { stdout: '{"authenticated":false}\n', stderr: "", code: 1 };
            throw new Error(`Unexpected args: ${joined}`);
          }),
        ),
      ),
    ),
  );

  it.effect("skips Amazon Q probes when the provider is disabled", () =>
    Effect.gen(function* () {
      const serverSettingsLayer = ServerSettingsService.layerTest({
        providers: { amazonQ: { enabled: false } },
      });
      const status = yield* checkCliAgentProviderStatus(AMAZON_Q_PROVIDER_CONFIG).pipe(
        Effect.provide(Layer.mergeAll(serverSettingsLayer, failingSpawnerLayer("spawn q ENOENT"))),
      );
      assert.strictEqual(status.provider, "amazonQ");
      assert.strictEqual(status.enabled, false);
      assert.strictEqual(status.status, "disabled");
      assert.strictEqual(status.installed, false);
      assert.strictEqual(status.message, "Amazon Q is disabled in T3 Code settings.");
    }),
  );
});
