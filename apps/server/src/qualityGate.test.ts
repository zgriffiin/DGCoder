import * as NodeServices from "@effect/platform-node/NodeServices";
import type { QualityGateSettings } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path } from "effect";

import { ServerConfig } from "./config";
import { GitCoreLive } from "./git/Layers/GitCore";
import { GitCore } from "./git/Services/GitCore";
import { QualityGateLive, QualityGateService, formatQualityGateFailureDetail } from "./qualityGate";
import { ServerSettingsService } from "./serverSettings";

const makeTestLayer = (qualityGate: Partial<QualityGateSettings>) =>
  QualityGateLive.pipe(
    Layer.provideMerge(GitCoreLive),
    Layer.provideMerge(
      ServerSettingsService.layerTest({
        qualityGate,
      }),
    ),
    Layer.provideMerge(
      ServerConfig.layerTest(process.cwd(), {
        prefix: "t3code-quality-gate-test-",
      }),
    ),
    Layer.provideMerge(NodeServices.layer),
  );

const MetricThresholdLayer = makeTestLayer({
  enabled: true,
  format: false,
  lint: false,
  typecheck: false,
  maxFileLines: 4,
  maxFunctionLines: 3,
  maxCyclomaticComplexity: 2,
});

const CommandCheckLayer = makeTestLayer({
  enabled: true,
  format: true,
  lint: true,
  typecheck: false,
  maxFileLines: null,
  maxFunctionLines: null,
  maxCyclomaticComplexity: null,
});

it.layer(MetricThresholdLayer)("QualityGateLive maintainability thresholds", (it) => {
  it.effect("fails changed files that exceed configured maintainability thresholds", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const git = yield* GitCore;
      const qualityGate = yield* QualityGateService;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3code-quality-gate-",
      });
      yield* git.initRepo({ cwd });

      const sourcePath = path.join(cwd, "src", "tooLarge.ts");
      yield* fileSystem.makeDirectory(path.dirname(sourcePath), { recursive: true });
      yield* fileSystem.writeFileString(
        sourcePath,
        [
          "export function tooLarge(input: string) {",
          "  if (input === 'a') return 1;",
          "  if (input === 'b' || input === 'c') return 2;",
          "  return input.length > 0 ? 3 : 4;",
          "}",
          "",
        ].join("\n"),
      );
      yield* git.execute({
        operation: "QualityGate.test.addIntentToAdd",
        cwd,
        args: ["add", "-N", "src/tooLarge.ts"],
      });

      const result = yield* qualityGate.evaluate({ cwd });

      assert.equal(result.status, "failed");
      assert.deepEqual(result.changedFiles, ["src/tooLarge.ts"]);
      assert.isTrue(result.failures.some((failure) => failure.ruleId === "max-file-lines"));
      assert.isTrue(result.failures.some((failure) => failure.ruleId === "max-function-lines"));
      assert.isTrue(
        result.failures.some((failure) => failure.ruleId === "max-cyclomatic-complexity"),
      );
      assert.match(formatQualityGateFailureDetail(result), /Fix these issues before continuing/);
    }),
  );
});

it.layer(CommandCheckLayer)("QualityGateLive command checks", (it) => {
  it.effect("reports configured formatting and lint command failures", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const qualityGate = yield* QualityGateService;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3code-quality-gate-commands-",
      });
      yield* fileSystem.writeFileString(
        path.join(cwd, "package.json"),
        JSON.stringify(
          {
            type: "module",
            scripts: {
              "fmt:check": "node -e \"process.stderr.write('format failed'); process.exit(1)\"",
              lint: "node -e \"process.stdout.write('lint failed'); process.exit(1)\"",
              typecheck: 'node -e "process.exit(0)"',
            },
          },
          null,
          2,
        ),
      );

      const result = yield* qualityGate.evaluate({ cwd });

      assert.equal(result.status, "failed");
      assert.isTrue(result.failures.some((failure) => failure.ruleId === "format"));
      assert.isTrue(result.failures.some((failure) => failure.ruleId === "lint"));
      assert.isFalse(result.failures.some((failure) => failure.ruleId === "typecheck"));
    }),
  );
});
