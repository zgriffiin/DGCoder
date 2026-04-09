import type {
  ModelCapabilities,
  ProviderKind,
  ServerSettings,
  ServerProvider,
  ServerProviderAuth,
  ServerProviderModel,
  ServerProviderState,
} from "@t3tools/contracts";
import { Effect, Equal, Layer, Option, Result, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  buildServerProvider,
  DEFAULT_TIMEOUT_MS,
  detailFromResult,
  extractAuthBoolean,
  isCommandMissingCause,
  isCommandMissingResult,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type CommandResult,
} from "../providerSnapshot";
import { makeManagedServerProvider } from "../makeManagedServerProvider";
import { ServerSettingsService } from "../../serverSettings";
import { KiroProvider } from "../Services/KiroProvider";
import { AmazonQProvider } from "../Services/AmazonQProvider";

interface CliAgentSettings {
  readonly enabled: boolean;
  readonly binaryPath: string;
  readonly customModels: ReadonlyArray<string>;
}

interface CliAgentProviderConfig {
  readonly provider: Extract<ProviderKind, "kiro" | "amazonQ">;
  readonly displayName: string;
  readonly binaryName: string;
  readonly defaultModelName: string;
  readonly versionCommands: ReadonlyArray<ReadonlyArray<string>>;
  readonly authCommand: ReadonlyArray<string>;
  readonly loginCommand: string;
  readonly disabledMessage: string;
  readonly selectSettings: (settings: ServerSettings) => CliAgentSettings;
}

const DEFAULT_CLI_AGENT_MODEL_CAPABILITIES: ModelCapabilities = {
  reasoningEffortLevels: [],
  supportsFastMode: false,
  supportsThinkingToggle: false,
  contextWindowOptions: [],
  promptInjectedEffortLevels: [],
};

const builtInModels = (name: string): ReadonlyArray<ServerProviderModel> => [
  {
    slug: "default",
    name,
    isCustom: false,
    capabilities: DEFAULT_CLI_AGENT_MODEL_CAPABILITIES,
  },
];

const UNSUPPORTED_AUTH_COMMAND_MARKERS = [
  "unknown command",
  "unrecognized command",
  "unexpected argument",
] as const;

const UNAUTHENTICATED_OUTPUT_MARKERS = [
  "not logged in",
  "not authenticated",
  "login required",
  "authentication required",
  "no active session",
  "run q login",
  "run kiro-cli login",
] as const;

function includesAnyMarker(value: string, markers: ReadonlyArray<string>): boolean {
  return markers.some((marker) => value.includes(marker));
}

function unauthenticatedAuthStatus(
  config: Pick<CliAgentProviderConfig, "displayName" | "loginCommand">,
) {
  return {
    status: "error" as const,
    auth: { status: "unauthenticated" as const },
    message: `${config.displayName} is not authenticated. Run \`${config.loginCommand}\` and try again.`,
  };
}

function parseAuthBooleanFromJson(stdout: string): {
  readonly attemptedJsonParse: boolean;
  readonly auth: boolean | undefined;
} {
  const trimmed = stdout.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
    return { attemptedJsonParse: false, auth: undefined };
  }
  try {
    return {
      attemptedJsonParse: true,
      auth: extractAuthBoolean(JSON.parse(trimmed)),
    };
  } catch {
    return { attemptedJsonParse: false, auth: undefined };
  }
}

function statusFromParsedAuth(
  result: CommandResult,
  config: Pick<CliAgentProviderConfig, "displayName" | "loginCommand">,
  parsedAuth: ReturnType<typeof parseAuthBooleanFromJson>,
) {
  if (parsedAuth.auth === true) {
    return { status: "ready" as const, auth: { status: "authenticated" as const } };
  }
  if (parsedAuth.auth === false) {
    return unauthenticatedAuthStatus(config);
  }
  if (parsedAuth.attemptedJsonParse) {
    return {
      status: "warning" as const,
      auth: { status: "unknown" as const },
      message: `Could not verify ${config.displayName} authentication status from JSON output (missing auth marker).`,
    };
  }
  if (result.code === 0) {
    return { status: "ready" as const, auth: { status: "authenticated" as const } };
  }
  const detail = detailFromResult(result);
  return {
    status: "warning" as const,
    auth: { status: "unknown" as const },
    message: detail
      ? `Could not verify ${config.displayName} authentication status. ${detail}`
      : `Could not verify ${config.displayName} authentication status.`,
  };
}

function parseCliAuthStatusFromOutput(
  result: CommandResult,
  config: Pick<CliAgentProviderConfig, "displayName" | "loginCommand">,
): {
  readonly status: Exclude<ServerProviderState, "disabled">;
  readonly auth: Pick<ServerProviderAuth, "status">;
  readonly message?: string;
} {
  const lowerOutput = `${result.stdout}\n${result.stderr}`.toLowerCase();
  if (includesAnyMarker(lowerOutput, UNSUPPORTED_AUTH_COMMAND_MARKERS)) {
    return {
      status: "warning",
      auth: { status: "unknown" },
      message: `${config.displayName} authentication status command is unavailable in this CLI version.`,
    };
  }
  if (includesAnyMarker(lowerOutput, UNAUTHENTICATED_OUTPUT_MARKERS)) {
    return unauthenticatedAuthStatus(config);
  }
  return statusFromParsedAuth(result, config, parseAuthBooleanFromJson(result.stdout));
}

const runCliCommand = Effect.fn("runCliCommand")(function* (
  binaryPath: string,
  args: ReadonlyArray<string>,
) {
  const command = ChildProcess.make(binaryPath, [...args], {
    shell: process.platform === "win32",
  });
  return yield* spawnAndCollect(binaryPath, command);
});

const runFirstSuccessfulCommand = Effect.fn("runFirstSuccessfulCommand")(function* (
  binaryPath: string,
  commands: ReadonlyArray<ReadonlyArray<string>>,
) {
  let lastResult: CommandResult | undefined;
  let lastError: unknown;

  for (const args of commands) {
    const result = yield* runCliCommand(binaryPath, args).pipe(Effect.result);
    if (Result.isFailure(result)) {
      lastError = result.failure;
      continue;
    }
    const commandResult = result.success;
    if (commandResult.code === 0) {
      return commandResult;
    }
    lastResult = commandResult;
    if (isCommandMissingResult(commandResult)) {
      return commandResult;
    }
  }

  if (lastResult) {
    return lastResult;
  }
  if (lastError) {
    return yield* Effect.fail(lastError);
  }

  return { stdout: "", stderr: "No health check command configured.", code: 1 };
});

function buildCliProviderSnapshot(input: {
  readonly config: CliAgentProviderConfig;
  readonly settings: CliAgentSettings;
  readonly checkedAt: string;
  readonly models: ReadonlyArray<ServerProviderModel>;
  readonly probe: Parameters<typeof buildServerProvider>[0]["probe"];
}) {
  return buildServerProvider({
    provider: input.config.provider,
    enabled: input.settings.enabled,
    checkedAt: input.checkedAt,
    models: input.models,
    probe: input.probe,
  });
}

function disabledCliProviderSnapshot(input: {
  readonly config: CliAgentProviderConfig;
  readonly settings: CliAgentSettings;
  readonly checkedAt: string;
  readonly models: ReadonlyArray<ServerProviderModel>;
}) {
  return buildCliProviderSnapshot({
    ...input,
    probe: {
      installed: false,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: input.config.disabledMessage,
    },
  });
}

function versionProbeFailureSnapshot(input: {
  readonly config: CliAgentProviderConfig;
  readonly settings: CliAgentSettings;
  readonly checkedAt: string;
  readonly models: ReadonlyArray<ServerProviderModel>;
  readonly error: unknown;
}) {
  const missing = isCommandMissingCause(input.error);
  return buildCliProviderSnapshot({
    ...input,
    probe: {
      installed: !missing,
      version: null,
      status: "error",
      auth: { status: "unknown" },
      message: missing
        ? `${input.config.displayName} CLI (\`${input.config.binaryName}\`) is not installed or not on PATH.`
        : `Failed to execute ${input.config.displayName} CLI health check: ${
            input.error instanceof Error ? input.error.message : String(input.error)
          }.`,
    },
  });
}

function versionTimeoutSnapshot(input: {
  readonly config: CliAgentProviderConfig;
  readonly settings: CliAgentSettings;
  readonly checkedAt: string;
  readonly models: ReadonlyArray<ServerProviderModel>;
}) {
  return buildCliProviderSnapshot({
    ...input,
    probe: {
      installed: true,
      version: null,
      status: "error",
      auth: { status: "unknown" },
      message: `${input.config.displayName} CLI is installed but failed to run. Timed out while running command.`,
    },
  });
}

function versionNonZeroSnapshot(
  input: {
    readonly config: CliAgentProviderConfig;
    readonly settings: CliAgentSettings;
    readonly checkedAt: string;
    readonly models: ReadonlyArray<ServerProviderModel>;
  },
  version: CommandResult,
) {
  const detail = detailFromResult(version);
  return buildCliProviderSnapshot({
    ...input,
    probe: {
      installed: true,
      version: parseGenericCliVersion(`${version.stdout}\n${version.stderr}`),
      status: "error",
      auth: { status: "unknown" },
      message: detail
        ? `${input.config.displayName} CLI is installed but failed to run. ${detail}`
        : `${input.config.displayName} CLI is installed but failed to run.`,
    },
  });
}

function authProbeFailureSnapshot(
  input: {
    readonly config: CliAgentProviderConfig;
    readonly settings: CliAgentSettings;
    readonly checkedAt: string;
    readonly models: ReadonlyArray<ServerProviderModel>;
  },
  parsedVersion: string | null,
  error: unknown,
) {
  return buildCliProviderSnapshot({
    ...input,
    probe: {
      installed: true,
      version: parsedVersion,
      status: "warning",
      auth: { status: "unknown" },
      message:
        error instanceof Error
          ? `Could not verify ${input.config.displayName} authentication status: ${error.message}.`
          : `Could not verify ${input.config.displayName} authentication status.`,
    },
  });
}

function authProbeTimeoutSnapshot(
  input: {
    readonly config: CliAgentProviderConfig;
    readonly settings: CliAgentSettings;
    readonly checkedAt: string;
    readonly models: ReadonlyArray<ServerProviderModel>;
  },
  parsedVersion: string | null,
) {
  return buildCliProviderSnapshot({
    ...input,
    probe: {
      installed: true,
      version: parsedVersion,
      status: "warning",
      auth: { status: "unknown" },
      message: `Could not verify ${input.config.displayName} authentication status. Timed out while running command.`,
    },
  });
}

function authenticatedSnapshot(
  input: {
    readonly config: CliAgentProviderConfig;
    readonly settings: CliAgentSettings;
    readonly checkedAt: string;
    readonly models: ReadonlyArray<ServerProviderModel>;
  },
  parsedVersion: string | null,
  authResult: CommandResult,
) {
  const parsed = parseCliAuthStatusFromOutput(authResult, input.config);
  return buildCliProviderSnapshot({
    ...input,
    probe: {
      installed: true,
      version: parsedVersion,
      status: parsed.status,
      auth: parsed.auth,
      ...(parsed.message ? { message: parsed.message } : {}),
    },
  });
}

const getProviderSettings = Effect.fn("getProviderSettings")(function* (
  config: CliAgentProviderConfig,
) {
  const providerSettings = yield* Effect.service(ServerSettingsService).pipe(
    Effect.flatMap((service) => service.getSettings),
    Effect.map(config.selectSettings),
    Effect.orDie,
  );
  return providerSettings;
});

export const checkCliAgentProviderStatus = Effect.fn("checkCliAgentProviderStatus")(function* (
  config: CliAgentProviderConfig,
): Effect.fn.Return<
  ServerProvider,
  never,
  ChildProcessSpawner.ChildProcessSpawner | ServerSettingsService
> {
  const providerSettings = yield* getProviderSettings(config);
  const checkedAt = new Date().toISOString();
  const models = providerModelsFromSettings(
    builtInModels(config.defaultModelName),
    config.provider,
    providerSettings.customModels,
    DEFAULT_CLI_AGENT_MODEL_CAPABILITIES,
  );
  const snapshotInput = { config, settings: providerSettings, checkedAt, models };

  if (!providerSettings.enabled) {
    return disabledCliProviderSnapshot(snapshotInput);
  }

  const versionProbe = yield* runFirstSuccessfulCommand(
    providerSettings.binaryPath,
    config.versionCommands,
  ).pipe(Effect.timeoutOption(DEFAULT_TIMEOUT_MS), Effect.result);

  if (Result.isFailure(versionProbe)) {
    return versionProbeFailureSnapshot({ ...snapshotInput, error: versionProbe.failure });
  }

  if (Option.isNone(versionProbe.success)) {
    return versionTimeoutSnapshot(snapshotInput);
  }

  const version = versionProbe.success.value;
  const parsedVersion = parseGenericCliVersion(`${version.stdout}\n${version.stderr}`);
  if (version.code !== 0) {
    return versionNonZeroSnapshot(snapshotInput, version);
  }

  const authProbe = yield* runCliCommand(providerSettings.binaryPath, config.authCommand).pipe(
    Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
    Effect.result,
  );

  if (Result.isFailure(authProbe)) {
    return authProbeFailureSnapshot(snapshotInput, parsedVersion, authProbe.failure);
  }

  if (Option.isNone(authProbe.success)) {
    return authProbeTimeoutSnapshot(snapshotInput, parsedVersion);
  }

  return authenticatedSnapshot(snapshotInput, parsedVersion, authProbe.success.value);
});

export const KIRO_PROVIDER_CONFIG: CliAgentProviderConfig = {
  provider: "kiro",
  displayName: "Kiro",
  binaryName: "kiro-cli",
  defaultModelName: "Kiro default",
  versionCommands: [["--version"], ["version"]],
  authCommand: ["whoami", "--format", "json"],
  loginCommand: "kiro-cli login",
  disabledMessage: "Kiro is disabled in T3 Code settings.",
  selectSettings: (settings) => settings.providers.kiro,
};

export const AMAZON_Q_PROVIDER_CONFIG: CliAgentProviderConfig = {
  provider: "amazonQ",
  displayName: "Amazon Q",
  binaryName: "q",
  defaultModelName: "Amazon Q default",
  versionCommands: [["--version"]],
  authCommand: ["whoami", "--format", "json"],
  loginCommand: "q login",
  disabledMessage: "Amazon Q is disabled in T3 Code settings.",
  selectSettings: (settings) => settings.providers.amazonQ,
};

function makeCliAgentProvider(config: CliAgentProviderConfig) {
  return Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const checkProvider = checkCliAgentProviderStatus(config).pipe(
      Effect.provideService(ServerSettingsService, serverSettings),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    );

    return yield* makeManagedServerProvider<CliAgentSettings>({
      getSettings: serverSettings.getSettings.pipe(Effect.map(config.selectSettings), Effect.orDie),
      streamSettings: serverSettings.streamChanges.pipe(Stream.map(config.selectSettings)),
      haveSettingsChanged: (previous, next) => !Equal.equals(previous, next),
      checkProvider,
    });
  });
}

export const KiroProviderLive = Layer.effect(
  KiroProvider,
  makeCliAgentProvider(KIRO_PROVIDER_CONFIG),
);

export const AmazonQProviderLive = Layer.effect(
  AmazonQProvider,
  makeCliAgentProvider(AMAZON_Q_PROVIDER_CONFIG),
);
