export type CliAgentExecutionMode = "auto" | "host" | "wsl";

export interface CliAgentCommandSettings {
  readonly binaryPath: string;
  readonly executionMode?: CliAgentExecutionMode;
  readonly wslDistro?: string;
}

export interface ResolveCliAgentCommandOptions {
  readonly cwd?: string;
  readonly platform?: NodeJS.Platform;
}

export interface ResolvedCliAgentCommand {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly shell: boolean;
  readonly cwd?: string;
  readonly display: string;
}

const DISPLAY_SAFE_ARG = /^[A-Za-z0-9_./:=@%+-]+$/;

function shellDisplayArg(value: string): string {
  if (value.length > 0 && DISPLAY_SAFE_ARG.test(value)) return value;
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function commandDisplay(command: string, args: ReadonlyArray<string>): string {
  return [command, ...args].map(shellDisplayArg).join(" ");
}

function resolvePlatform(platform: NodeJS.Platform | undefined): NodeJS.Platform {
  const runtime = globalThis as typeof globalThis & {
    readonly process?: { readonly platform?: NodeJS.Platform };
  };
  return platform ?? runtime.process?.platform ?? "win32";
}

function wslExecutable(platform: NodeJS.Platform): string {
  return platform === "win32" ? "wsl.exe" : "wsl";
}

export function windowsPathToWslPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const match = /^([A-Za-z]):\/(.*)$/.exec(normalized);
  if (!match) return path;

  const drive = match[1];
  const rest = match[2];
  if (!drive || rest === undefined) return path;

  return `/mnt/${drive.toLowerCase()}/${rest}`;
}

export function resolveCliAgentCommand(
  settings: CliAgentCommandSettings,
  args: ReadonlyArray<string>,
  options: ResolveCliAgentCommandOptions = {},
): ResolvedCliAgentCommand {
  const platform = resolvePlatform(options.platform);
  const executionMode = settings.executionMode ?? "host";
  const binaryPath = settings.binaryPath.trim();
  const effectiveExecutionMode =
    executionMode === "auto" ? (platform === "win32" ? "wsl" : "host") : executionMode;

  if (effectiveExecutionMode !== "wsl") {
    return {
      command: binaryPath,
      args: [...args],
      shell: platform === "win32",
      ...(options.cwd ? { cwd: options.cwd } : {}),
      display: commandDisplay(binaryPath, args),
    };
  }

  const wslArgs: string[] = [];
  const distro = settings.wslDistro?.trim();
  if (distro) {
    wslArgs.push("-d", distro);
  }
  if (options.cwd) {
    wslArgs.push("--cd", platform === "win32" ? windowsPathToWslPath(options.cwd) : options.cwd);
  }
  wslArgs.push("--exec", "bash", "-lc", 'exec "$@"', "bash", binaryPath, ...args);

  const command = wslExecutable(platform);
  return {
    command,
    args: wslArgs,
    shell: false,
    display: commandDisplay(command, wslArgs),
  };
}

export function buildCliAgentLoginCommand(
  settings: CliAgentCommandSettings,
  options?: ResolveCliAgentCommandOptions,
): string {
  return resolveCliAgentCommand(settings, ["login"], options).display;
}
