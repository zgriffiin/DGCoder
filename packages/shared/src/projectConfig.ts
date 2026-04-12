import fs from "node:fs";
import path from "node:path";

import { Exit, Schema } from "effect";
import {
  DEFAULT_LOCAL_REVIEW_ENFORCE_ON,
  DEFAULT_LOCAL_REVIEW_TIMEOUT_MS,
  type GitStackedAction,
  type LocalReviewConfig,
  T3CodeProjectConfig,
  type T3CodeProjectConfig as T3CodeProjectConfigType,
} from "@t3tools/contracts";

import { formatSchemaError } from "./schemaJson";

export const T3CODE_PROJECT_CONFIG_RELATIVE_PATH = path.join(".t3code", "project.json");
export const LOCAL_REVIEW_SUPPORTED_TOKENS = ["defaultBranch"] as const;

export type T3CodeProjectConfigLoadResult =
  | {
      status: "missing";
      configPath: string;
    }
  | {
      status: "invalid";
      configPath: string;
      reason: string;
    }
  | {
      status: "loaded";
      configPath: string;
      config: T3CodeProjectConfigType;
    };

const decodeProjectConfig = Schema.decodeUnknownExit(T3CodeProjectConfig);

function findUnsupportedTokens(args: ReadonlyArray<string>): string[] {
  const tokens = new Set<string>();
  for (const arg of args) {
    const matches = arg.matchAll(/{{([^{}]+)}}/g);
    for (const match of matches) {
      const token = match[1]?.trim() ?? "";
      if (token.length > 0 && !LOCAL_REVIEW_SUPPORTED_TOKENS.includes(token as never)) {
        tokens.add(token);
      }
    }
  }
  return [...tokens].toSorted((a, b) => a.localeCompare(b));
}

export function resolveT3CodeProjectConfigPath(cwd: string): string {
  return path.join(cwd, T3CODE_PROJECT_CONFIG_RELATIVE_PATH);
}

export function parseT3CodeProjectConfigText(input: {
  text: string;
  configPath: string;
}): T3CodeProjectConfigLoadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.text) as unknown;
  } catch (error) {
    return {
      status: "invalid",
      configPath: input.configPath,
      reason: error instanceof Error ? error.message : "Invalid JSON.",
    };
  }

  const decoded = decodeProjectConfig(parsed);
  if (Exit.isFailure(decoded)) {
    return {
      status: "invalid",
      configPath: input.configPath,
      reason: formatSchemaError(decoded.cause),
    };
  }

  const unsupportedTokens =
    decoded.value.localReview === undefined
      ? []
      : findUnsupportedTokens(decoded.value.localReview.args);
  if (unsupportedTokens.length > 0) {
    return {
      status: "invalid",
      configPath: input.configPath,
      reason: `Unsupported local review token(s): ${unsupportedTokens.map((token) => `{{${token}}}`).join(", ")}.`,
    };
  }

  return {
    status: "loaded",
    configPath: input.configPath,
    config: decoded.value,
  };
}

export function loadT3CodeProjectConfig(cwd: string): T3CodeProjectConfigLoadResult {
  const configPath = resolveT3CodeProjectConfigPath(cwd);
  try {
    const text = fs.readFileSync(configPath, "utf8");
    return parseT3CodeProjectConfigText({ text, configPath });
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return {
        status: "missing",
        configPath,
      };
    }

    return {
      status: "invalid",
      configPath,
      reason: error instanceof Error ? error.message : "Failed to read config file.",
    };
  }
}

export function substituteLocalReviewArgs(
  args: ReadonlyArray<string>,
  input: { defaultBranch: string },
): ReadonlyArray<string> {
  return args.map((arg) =>
    arg.replace(/{{([^{}]+)}}/g, (_, rawToken: string) => {
      const token = rawToken.trim();
      if (token === "defaultBranch") {
        return input.defaultBranch;
      }
      throw new Error(`Unsupported local review token: {{${token}}}.`);
    }),
  );
}

function formatCommandPreviewToken(value: string): string {
  if (value.length === 0) {
    return '""';
  }
  return /[\s"]/u.test(value) ? JSON.stringify(value) : value;
}

export function buildLocalReviewCommandPreview(
  command: string,
  args: ReadonlyArray<string>,
): string {
  return [command, ...args].map(formatCommandPreviewToken).join(" ");
}

export function resolveLocalReviewEnforceOn(
  localReview: LocalReviewConfig | undefined,
): ReadonlyArray<GitStackedAction> {
  return localReview?.enforceOn ?? DEFAULT_LOCAL_REVIEW_ENFORCE_ON;
}

export function defaultLocalReviewSummaryValues() {
  return {
    tool: "coderabbit" as const,
    enforceOn: [...DEFAULT_LOCAL_REVIEW_ENFORCE_ON] as GitStackedAction[],
    commandPreview: "",
    timeoutMs: DEFAULT_LOCAL_REVIEW_TIMEOUT_MS,
  };
}
