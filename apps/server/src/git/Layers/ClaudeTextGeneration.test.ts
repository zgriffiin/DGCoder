import { delimiter as PATH_DELIMITER } from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path } from "effect";
import { expect } from "vitest";

import { ServerConfig } from "../../config.ts";
import { TextGeneration } from "../Services/TextGeneration.ts";
import { sanitizeThreadTitle } from "../Utils.ts";
import { ClaudeTextGenerationLive } from "./ClaudeTextGeneration.ts";
import { ServerSettingsService } from "../../serverSettings.ts";

const ClaudeTextGenerationTestLayer = ClaudeTextGenerationLive.pipe(
  Layer.provideMerge(ServerSettingsService.layerTest()),
  Layer.provideMerge(
    ServerConfig.layerTest(process.cwd(), {
      prefix: "t3code-claude-text-generation-test-",
    }),
  ),
  Layer.provideMerge(NodeServices.layer),
);

function makeFakeClaudeBinary(
  dir: string,
  input: {
    output: string;
    exitCode?: number;
    stderr?: string;
    argsMustContain?: string;
    argsMustContainAll?: ReadonlyArray<string>;
    argsMustNotContain?: string;
    argsMustNotContainAll?: ReadonlyArray<string>;
    stdinMustContain?: string;
  },
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const binDir = path.join(dir, "bin");
    const claudeScriptPath = path.join(binDir, "claude.mjs");
    const claudePath = path.join(binDir, process.platform === "win32" ? "claude.cmd" : "claude");
    yield* fs.makeDirectory(binDir, { recursive: true });

    yield* fs.writeFileString(
      claudeScriptPath,
      [
        'import { readFileSync } from "node:fs";',
        `const input = ${JSON.stringify(input)};`,
        'const args = process.argv.slice(2).join(" ");',
        'const stdinContent = readFileSync(0, "utf8");',
        "if (input.argsMustContain && !args.includes(input.argsMustContain)) {",
        '  process.stderr.write("args missing expected content\\n");',
        "  process.exit(2);",
        "}",
        "if (input.argsMustContainAll && !input.argsMustContainAll.every((value) => args.includes(value))) {",
        '  process.stderr.write("args missing expected content\\n");',
        "  process.exit(2);",
        "}",
        "if (input.argsMustNotContain && args.includes(input.argsMustNotContain)) {",
        '  process.stderr.write("args contained forbidden content\\n");',
        "  process.exit(3);",
        "}",
        "if (input.argsMustNotContainAll && input.argsMustNotContainAll.some((value) => args.includes(value))) {",
        '  process.stderr.write("args contained forbidden content\\n");',
        "  process.exit(3);",
        "}",
        "if (input.stdinMustContain && !stdinContent.includes(input.stdinMustContain)) {",
        '  process.stderr.write("stdin missing expected content\\n");',
        "  process.exit(4);",
        "}",
        "if (input.stderr) {",
        "  process.stderr.write(`${input.stderr}\\n`);",
        "}",
        "process.stdout.write(input.output);",
        "process.exit(input.exitCode ?? 0);",
        "",
      ].join("\n"),
    );
    yield* fs.writeFileString(
      claudePath,
      process.platform === "win32"
        ? ["@echo off", 'node "%~dp0claude.mjs" %*', ""].join("\r\n")
        : ["#!/bin/sh", 'exec node "$0.mjs" "$@"', ""].join("\n"),
    );
    yield* fs.chmod(claudeScriptPath, 0o755);
    yield* fs.chmod(claudePath, 0o755);
    return binDir;
  });
}

function withFakeClaudeEnv<A, E, R>(
  input: {
    output: string;
    exitCode?: number;
    stderr?: string;
    argsMustContain?: string;
    argsMustContainAll?: ReadonlyArray<string>;
    argsMustNotContain?: string;
    argsMustNotContainAll?: ReadonlyArray<string>;
    stdinMustContain?: string;
  },
  effect: Effect.Effect<A, E, R>,
) {
  return Effect.acquireUseRelease(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-claude-text-" });
      const binDir = yield* makeFakeClaudeBinary(tempDir, input);
      const previousPath = process.env.PATH;

      yield* Effect.sync(() => {
        process.env.PATH = [binDir, previousPath ?? ""]
          .filter((value) => value.length > 0)
          .join(PATH_DELIMITER);
      });

      return { previousPath };
    }),
    () => effect,
    ({ previousPath }) =>
      Effect.sync(() => {
        process.env.PATH = previousPath;
      }),
  );
}

it.layer(ClaudeTextGenerationTestLayer)("ClaudeTextGenerationLive", (it) => {
  it.effect("forwards Claude thinking settings for Haiku without passing effort", () =>
    withFakeClaudeEnv(
      {
        output: JSON.stringify({
          structured_output: {
            subject: "Add important change",
            body: "",
          },
        }),
        argsMustContainAll: ["--settings", "alwaysThinkingEnabled", "false"],
        argsMustNotContain: "--effort",
      },
      Effect.gen(function* () {
        const textGeneration = yield* TextGeneration;

        const generated = yield* textGeneration.generateCommitMessage({
          cwd: process.cwd(),
          branch: "feature/claude-effect",
          stagedSummary: "M README.md",
          stagedPatch: "diff --git a/README.md b/README.md",
          modelSelection: {
            provider: "claudeAgent",
            model: "claude-haiku-4-5",
            options: {
              thinking: false,
              effort: "high",
            },
          },
        });

        expect(generated.subject).toBe("Add important change");
      }),
    ),
  );

  it.effect("forwards Claude fast mode and supported effort", () =>
    withFakeClaudeEnv(
      {
        output: JSON.stringify({
          structured_output: {
            title: "Improve orchestration flow",
            body: "Body",
          },
        }),
        argsMustContainAll: ["--effort", "max", "--settings", "fastMode", "true"],
      },
      Effect.gen(function* () {
        const textGeneration = yield* TextGeneration;

        const generated = yield* textGeneration.generatePrContent({
          cwd: process.cwd(),
          baseBranch: "main",
          headBranch: "feature/claude-effect",
          commitSummary: "Improve orchestration",
          diffSummary: "1 file changed",
          diffPatch: "diff --git a/README.md b/README.md",
          modelSelection: {
            provider: "claudeAgent",
            model: "claude-opus-4-6",
            options: {
              effort: "max",
              fastMode: true,
            },
          },
        });

        expect(generated.title).toBe("Improve orchestration flow");
      }),
    ),
  );

  it.effect("generates thread titles through the Claude provider", () =>
    withFakeClaudeEnv(
      {
        output: JSON.stringify({
          structured_output: {
            title:
              '  "Reconnect failures after restart because the session state does not recover"  ',
          },
        }),
        stdinMustContain: "You write concise thread titles for coding conversations.",
      },
      Effect.gen(function* () {
        const textGeneration = yield* TextGeneration;

        const generated = yield* textGeneration.generateThreadTitle({
          cwd: process.cwd(),
          message: "Please investigate reconnect failures after restarting the session.",
          modelSelection: {
            provider: "claudeAgent",
            model: "claude-sonnet-4-6",
          },
        });

        expect(generated.title).toBe(
          sanitizeThreadTitle(
            '"Reconnect failures after restart because the session state does not recover"',
          ),
        );
      }),
    ),
  );

  it.effect("falls back when Claude thread title normalization becomes whitespace-only", () =>
    withFakeClaudeEnv(
      {
        output: JSON.stringify({
          structured_output: {
            title: '  """   """  ',
          },
        }),
      },
      Effect.gen(function* () {
        const textGeneration = yield* TextGeneration;

        const generated = yield* textGeneration.generateThreadTitle({
          cwd: process.cwd(),
          message: "Name this thread.",
          modelSelection: {
            provider: "claudeAgent",
            model: "claude-sonnet-4-6",
          },
        });

        expect(generated.title).toBe("New thread");
      }),
    ),
  );
});
