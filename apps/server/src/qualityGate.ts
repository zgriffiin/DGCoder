import nodePath from "node:path";

import { DEFAULT_SERVER_SETTINGS, type QualityGateSettings } from "@t3tools/contracts";
import { Effect, FileSystem, Layer, Path, ServiceMap } from "effect";
import ts from "typescript";

import { GitCore } from "./git/Services/GitCore";
import { runProcess } from "./processRunner";
import { ServerSettingsService } from "./serverSettings";

export const QUALITY_GATE_FAILED_ACTIVITY_KIND = "quality-gate.failed";
export const QUALITY_GATE_PASSED_ACTIVITY_KIND = "quality-gate.passed";

export interface QualityGateFailure {
  readonly ruleId:
    | "format"
    | "lint"
    | "typecheck"
    | "max-file-lines"
    | "max-function-lines"
    | "max-cyclomatic-complexity";
  readonly message: string;
  readonly filePath?: string;
  readonly metric?: number;
  readonly threshold?: number;
  readonly output?: string;
}

export interface QualityGateResult {
  readonly status: "passed" | "failed" | "skipped";
  readonly cwd: string;
  readonly checkedAt: string;
  readonly changedFiles: ReadonlyArray<string>;
  readonly failures: ReadonlyArray<QualityGateFailure>;
}

export interface QualityGateShape {
  readonly evaluate: (input: { readonly cwd: string }) => Effect.Effect<QualityGateResult>;
}

export class QualityGateService extends ServiceMap.Service<QualityGateService, QualityGateShape>()(
  "t3/qualityGate/QualityGateService",
) {
  static readonly layerTest = (result: QualityGateResult) =>
    Layer.succeed(QualityGateService, {
      evaluate: (input) =>
        Effect.succeed({
          ...result,
          cwd: input.cwd,
        }),
    } satisfies QualityGateShape);
}

const COMMAND_TIMEOUT_MS = 120_000;
const COMMAND_OUTPUT_LIMIT_BYTES = 96_000;
const MAX_FAILURES_PER_RULE = 20;
const ANALYZABLE_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);

function normalizeOutput(stdout: string, stderr: string): string | undefined {
  const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n\n").trim();
  if (output.length === 0) {
    return undefined;
  }
  return output.length > 4_000 ? `${output.slice(0, 4_000)}\n... [truncated]` : output;
}

async function runCommandCheck(input: {
  readonly cwd: string;
  readonly ruleId: "format" | "lint" | "typecheck";
  readonly label: string;
  readonly args: ReadonlyArray<string>;
}): Promise<QualityGateFailure | null> {
  try {
    const result = await runProcess("bun", input.args, {
      cwd: input.cwd,
      allowNonZeroExit: true,
      timeoutMs: COMMAND_TIMEOUT_MS,
      maxBufferBytes: COMMAND_OUTPUT_LIMIT_BYTES,
      outputMode: "truncate",
    });
    if (!result.timedOut && result.code === 0) {
      return null;
    }
    const command = ["bun", ...input.args].join(" ");
    const output = normalizeOutput(result.stdout, result.stderr);
    const failure: QualityGateFailure = {
      ruleId: input.ruleId,
      message: result.timedOut
        ? `${input.label} timed out after ${COMMAND_TIMEOUT_MS / 1_000}s.`
        : `${input.label} failed (${command}).`,
    };
    return output ? { ...failure, output } : failure;
  } catch (error) {
    const failure: QualityGateFailure = {
      ruleId: input.ruleId,
      message: `${input.label} could not run.`,
    };
    return error instanceof Error ? { ...failure, output: error.message } : failure;
  }
}

function isAnalyzableCodePath(relativePath: string): boolean {
  return ANALYZABLE_EXTENSIONS.has(nodePath.extname(relativePath).toLowerCase());
}

function countLines(source: string): number {
  if (source.length === 0) {
    return 0;
  }
  const normalized = source.endsWith("\n") ? source.slice(0, -1) : source;
  return normalized.length === 0 ? 0 : normalized.split(/\r?\n/g).length;
}

function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node)
  );
}

function functionName(node: ts.FunctionLikeDeclaration, sourceFile: ts.SourceFile): string {
  const named = "name" in node ? node.name : undefined;
  if (named && ts.isIdentifier(named)) {
    return named.text;
  }
  const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  return `anonymous function at line ${line}`;
}

function cyclomaticComplexity(node: ts.FunctionLikeDeclaration): number {
  let complexity = 1;

  const visit = (child: ts.Node): void => {
    if (child !== node && isFunctionLike(child)) {
      return;
    }

    if (
      ts.isIfStatement(child) ||
      ts.isConditionalExpression(child) ||
      ts.isForStatement(child) ||
      ts.isForInStatement(child) ||
      ts.isForOfStatement(child) ||
      ts.isWhileStatement(child) ||
      ts.isDoStatement(child) ||
      ts.isCatchClause(child) ||
      ts.isCaseClause(child)
    ) {
      complexity += 1;
    }

    if (
      ts.isBinaryExpression(child) &&
      (child.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        child.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        child.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
    ) {
      complexity += 1;
    }

    ts.forEachChild(child, visit);
  };

  ts.forEachChild(node, visit);
  return complexity;
}

function analyzeCodeFile(input: {
  readonly relativePath: string;
  readonly source: string;
  readonly settings: QualityGateSettings;
}): ReadonlyArray<QualityGateFailure> {
  const failures: QualityGateFailure[] = [];
  const lineCount = countLines(input.source);
  if (input.settings.maxFileLines !== null && lineCount > input.settings.maxFileLines) {
    failures.push({
      ruleId: "max-file-lines",
      filePath: input.relativePath,
      metric: lineCount,
      threshold: input.settings.maxFileLines,
      message: `${input.relativePath} has ${lineCount} lines (limit ${input.settings.maxFileLines}).`,
    });
  }

  if (input.settings.maxFunctionLines === null && input.settings.maxCyclomaticComplexity === null) {
    return failures;
  }

  const scriptKind =
    input.relativePath.endsWith(".tsx") || input.relativePath.endsWith(".jsx")
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    input.relativePath,
    input.source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );

  const visit = (node: ts.Node): void => {
    if (isFunctionLike(node)) {
      const startLine =
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
      const length = endLine - startLine + 1;
      const name = functionName(node, sourceFile);
      if (input.settings.maxFunctionLines !== null && length > input.settings.maxFunctionLines) {
        failures.push({
          ruleId: "max-function-lines",
          filePath: input.relativePath,
          metric: length,
          threshold: input.settings.maxFunctionLines,
          message: `${input.relativePath}:${startLine} ${name} has ${length} lines (limit ${input.settings.maxFunctionLines}).`,
        });
      }

      const complexity = cyclomaticComplexity(node);
      if (
        input.settings.maxCyclomaticComplexity !== null &&
        complexity > input.settings.maxCyclomaticComplexity
      ) {
        failures.push({
          ruleId: "max-cyclomatic-complexity",
          filePath: input.relativePath,
          metric: complexity,
          threshold: input.settings.maxCyclomaticComplexity,
          message: `${input.relativePath}:${startLine} ${name} has cyclomatic complexity ${complexity} (limit ${input.settings.maxCyclomaticComplexity}).`,
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);
  return failures;
}

export function formatQualityGateFailureDetail(result: QualityGateResult): string {
  const failures = result.failures.slice(0, 8);
  const suffix =
    result.failures.length > failures.length
      ? `\n- ${result.failures.length - failures.length} more failure(s) omitted.`
      : "";
  return (
    [
      "Quality gate failed after agent file changes. Fix these issues before continuing:",
      ...failures.map((failure) => {
        const output = failure.output ? `\n${failure.output}` : "";
        return `- ${failure.message}${output}`;
      }),
    ].join("\n") + suffix
  );
}

export function prependQualityGateReminder(message: string, detail: string): string {
  return [
    "A previous agent file change failed the quality gate. Remediate this before doing unrelated work.",
    "",
    detail,
    "",
    "User request:",
    message,
  ].join("\n");
}

const make = Effect.gen(function* () {
  const git = yield* GitCore;
  const fileSystem = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;
  const serverSettings = yield* ServerSettingsService;

  const changedFiles = (cwd: string) =>
    git.statusDetailsLocal(cwd).pipe(
      Effect.map((status) =>
        [...new Set(status.workingTree.files.map((file) => file.path))].toSorted((a, b) =>
          a.localeCompare(b),
        ),
      ),
      Effect.catch(() => Effect.succeed([] as string[])),
    );

  const analyzeChangedFiles = Effect.fn("analyzeChangedFiles")(function* (
    cwd: string,
    settings: QualityGateSettings,
    files: ReadonlyArray<string>,
  ) {
    const codeFiles = files.filter(isAnalyzableCodePath);
    const failures: QualityGateFailure[] = [];

    for (const relativePath of codeFiles) {
      const absolutePath = pathService.join(cwd, relativePath);
      const exists = yield* fileSystem
        .exists(absolutePath)
        .pipe(Effect.catch(() => Effect.succeed(false)));
      if (!exists) {
        continue;
      }
      const source = yield* fileSystem
        .readFileString(absolutePath)
        .pipe(Effect.catch(() => Effect.succeed("")));
      failures.push(
        ...analyzeCodeFile({
          relativePath,
          source,
          settings,
        }),
      );
      if (failures.length >= MAX_FAILURES_PER_RULE * 3) {
        break;
      }
    }

    return failures.slice(0, MAX_FAILURES_PER_RULE * 3);
  });

  const evaluate: QualityGateShape["evaluate"] = Effect.fn("qualityGate.evaluate")(function* ({
    cwd,
  }) {
    const settings = yield* serverSettings.getSettings.pipe(
      Effect.map((serverSettings) => serverSettings.qualityGate),
      Effect.catch(() => Effect.succeed(DEFAULT_SERVER_SETTINGS.qualityGate)),
    );
    const checkedAt = new Date().toISOString();
    if (!settings.enabled) {
      return {
        status: "skipped",
        cwd,
        checkedAt,
        changedFiles: [],
        failures: [],
      };
    }

    const files = yield* changedFiles(cwd);
    const commandChecks = yield* Effect.tryPromise(() =>
      Promise.all([
        settings.format
          ? runCommandCheck({
              cwd,
              ruleId: "format",
              label: "Format check",
              args: ["run", "fmt:check"],
            })
          : Promise.resolve(null),
        settings.lint
          ? runCommandCheck({
              cwd,
              ruleId: "lint",
              label: "Lint check",
              args: ["run", "lint"],
            })
          : Promise.resolve(null),
        settings.typecheck
          ? runCommandCheck({
              cwd,
              ruleId: "typecheck",
              label: "Typecheck",
              args: ["run", "typecheck"],
            })
          : Promise.resolve(null),
      ]),
    ).pipe(Effect.catch(() => Effect.succeed([] as Array<QualityGateFailure | null>)));
    const metricFailures = yield* analyzeChangedFiles(cwd, settings, files);
    const failures = [
      ...commandChecks.filter((failure): failure is QualityGateFailure => failure !== null),
      ...metricFailures,
    ];

    return {
      status: failures.length > 0 ? "failed" : "passed",
      cwd,
      checkedAt,
      changedFiles: files,
      failures,
    };
  });

  return {
    evaluate,
  } satisfies QualityGateShape;
});

export const QualityGateLive = Layer.effect(QualityGateService, make);
