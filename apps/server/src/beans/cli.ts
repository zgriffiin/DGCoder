import { existsSync } from "node:fs";
import path from "node:path";
import { Effect, Schema } from "effect";
import {
  BeansArchiveResult,
  BeansBean,
  BeansCommandError,
  BeansCreateResult,
  BeansInitResult,
  BeansListResult,
  BeansProjectState,
  BeansRoadmapResult,
  BeansUpdateResult,
  type BeansArchiveInput,
  type BeansCreateInput,
  type BeansInitInput,
  type BeansListInput,
  type BeansProjectStateInput,
  type BeansRoadmapInput,
  type BeansUpdateInput,
} from "@t3tools/contracts";
import { runProcess } from "../processRunner";

const DEFAULT_TIMEOUT_MS = 30_000;

const BeansCreateEnvelope = Schema.Struct({
  success: Schema.Boolean,
  bean: BeansBean,
  message: Schema.optional(Schema.String),
});

const BeansUpdateEnvelope = Schema.Struct({
  success: Schema.Boolean,
  bean: BeansBean,
  message: Schema.optional(Schema.String),
});

const BeansArchiveEnvelope = Schema.Struct({
  success: Schema.Boolean,
  message: Schema.String,
});

function normalizeBeansCliError(operation: string, error: unknown): BeansCommandError {
  if (Schema.is(BeansCommandError)(error)) {
    return error;
  }
  if (error instanceof Error) {
    if (error.message.includes("Command not found: beans")) {
      return new BeansCommandError({
        operation,
        detail: "Beans CLI (`beans`) is required but not available on PATH.",
        cause: error,
      });
    }
    if (error.message.toLowerCase().includes("not a beans project")) {
      return new BeansCommandError({
        operation,
        detail: "This workspace is not initialized for Beans yet.",
        cause: error,
      });
    }
    return new BeansCommandError({
      operation,
      detail: `Beans command failed: ${error.message}`,
      cause: error,
    });
  }

  return new BeansCommandError({
    operation,
    detail: "Beans command failed.",
    cause: error,
  });
}

function decodeBeansJson<S extends Schema.Top>(
  raw: string,
  schema: S,
  operation: string,
  invalidDetail: string,
): S["Type"] {
  try {
    return Schema.decodeUnknownSync(schema as any)(JSON.parse(raw));
  } catch (error) {
    throw new BeansCommandError({
      operation,
      detail: error instanceof Error ? `${invalidDetail}: ${error.message}` : invalidDetail,
      cause: error,
    });
  }
}

function buildState(input: {
  readonly cwd: string;
  readonly installed: boolean;
  readonly initialized: boolean;
  readonly cliVersion?: string | undefined;
}) {
  return Schema.decodeUnknownSync(BeansProjectState)({
    installed: input.installed,
    initialized: input.initialized,
    ...(input.cliVersion ? { cliVersion: input.cliVersion } : {}),
    configPath: path.join(input.cwd, ".beans.yml"),
    beansPath: path.join(input.cwd, ".beans"),
  });
}

function buildCreateArgs(input: BeansCreateInput): string[] {
  const args = ["create", "--json"];
  if (input.status) args.push("--status", input.status);
  if (input.type) args.push("--type", input.type);
  if (input.priority) args.push("--priority", input.priority);
  if (input.parent) args.push("--parent", input.parent);
  if (input.body !== undefined) args.push("--body", input.body);
  args.push(input.title);
  return args;
}

function buildUpdateArgs(input: BeansUpdateInput): string[] {
  const args = ["update", input.id, "--json"];
  if (input.title) args.push("--title", input.title);
  if (input.status) args.push("--status", input.status);
  if (input.type) args.push("--type", input.type);
  if (input.priority !== undefined) args.push("--priority", input.priority);
  if (input.body !== undefined) args.push("--body", input.body);
  return args;
}

async function executeBeans(input: {
  readonly cwd: string;
  readonly args: ReadonlyArray<string>;
  readonly operation: string;
  readonly timeoutMs?: number;
}) {
  try {
    return await runProcess("beans", input.args, {
      cwd: input.cwd,
      timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
  } catch (error) {
    throw normalizeBeansCliError(input.operation, error);
  }
}

export function getBeansProjectState(input: BeansProjectStateInput) {
  return Effect.tryPromise({
    try: async () => {
      const initialized =
        existsSync(path.join(input.cwd, ".beans.yml")) ||
        existsSync(path.join(input.cwd, ".beans"));
      try {
        const result = await executeBeans({
          cwd: input.cwd,
          args: ["version"],
          operation: "getProjectState",
          timeoutMs: 10_000,
        });
        const cliVersion = result.stdout.trim();
        return buildState({
          cwd: input.cwd,
          installed: cliVersion.length > 0,
          initialized,
          ...(cliVersion.length > 0 ? { cliVersion } : {}),
        });
      } catch (error) {
        if (
          Schema.is(BeansCommandError)(error) &&
          error.detail.includes("required but not available on PATH")
        ) {
          return buildState({
            cwd: input.cwd,
            installed: false,
            initialized,
          });
        }
        throw error;
      }
    },
    catch: (error) => normalizeBeansCliError("getProjectState", error),
  });
}

export function initBeansProject(input: BeansInitInput) {
  return Effect.tryPromise({
    try: async () => {
      const result = await executeBeans({
        cwd: input.cwd,
        args: ["init"],
        operation: "init",
      });
      const state = await Effect.runPromise(getBeansProjectState(input));
      return Schema.decodeUnknownSync(BeansInitResult)({
        state,
        message: result.stdout.trim() || "Initialized beans project",
      });
    },
    catch: (error) => normalizeBeansCliError("init", error),
  });
}

export function listBeans(input: BeansListInput) {
  return Effect.tryPromise({
    try: async () => {
      const args = ["list", "--json"];
      if (input.includeBody !== false) {
        args.push("--full");
      }
      if (input.readyOnly) {
        args.push("--ready");
      }
      if (input.search) {
        args.push("--search", input.search);
      }
      const result = await executeBeans({
        cwd: input.cwd,
        args,
        operation: "list",
      });
      const beans = decodeBeansJson(
        result.stdout.trim(),
        Schema.Array(BeansBean),
        "list",
        "Beans CLI returned invalid JSON.",
      );
      return Schema.decodeUnknownSync(BeansListResult)({ beans });
    },
    catch: (error) => normalizeBeansCliError("list", error),
  });
}

export function createBean(input: BeansCreateInput) {
  return Effect.tryPromise({
    try: async () => {
      const result = await executeBeans({
        cwd: input.cwd,
        args: buildCreateArgs(input),
        operation: "create",
      });
      const decoded = decodeBeansJson(
        result.stdout.trim(),
        BeansCreateEnvelope,
        "create",
        "Beans CLI returned invalid create JSON.",
      );
      return Schema.decodeUnknownSync(BeansCreateResult)({
        bean: decoded.bean,
        message: decoded.message?.trim() || "Bean created",
      });
    },
    catch: (error) => normalizeBeansCliError("create", error),
  });
}

export function updateBean(input: BeansUpdateInput) {
  return Effect.tryPromise({
    try: async () => {
      const result = await executeBeans({
        cwd: input.cwd,
        args: buildUpdateArgs(input),
        operation: "update",
      });
      const decoded = decodeBeansJson(
        result.stdout.trim(),
        BeansUpdateEnvelope,
        "update",
        "Beans CLI returned invalid update JSON.",
      );
      return Schema.decodeUnknownSync(BeansUpdateResult)({
        bean: decoded.bean,
        message: decoded.message?.trim() || "Bean updated",
      });
    },
    catch: (error) => normalizeBeansCliError("update", error),
  });
}

export function archiveBeansProject(input: BeansArchiveInput) {
  return Effect.tryPromise({
    try: async () => {
      const result = await executeBeans({
        cwd: input.cwd,
        args: ["archive", "--json"],
        operation: "archive",
      });
      const decoded = decodeBeansJson(
        result.stdout.trim(),
        BeansArchiveEnvelope,
        "archive",
        "Beans CLI returned invalid archive JSON.",
      );
      return Schema.decodeUnknownSync(BeansArchiveResult)({
        message: decoded.message,
      });
    },
    catch: (error) => normalizeBeansCliError("archive", error),
  });
}

export function getBeansRoadmap(input: BeansRoadmapInput) {
  return Effect.tryPromise({
    try: async () => {
      const result = await executeBeans({
        cwd: input.cwd,
        args: ["roadmap"],
        operation: "roadmap",
      });
      return Schema.decodeUnknownSync(BeansRoadmapResult)({
        markdown: result.stdout,
      });
    },
    catch: (error) => normalizeBeansCliError("roadmap", error),
  });
}
