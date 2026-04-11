import * as FS from "node:fs";
import * as Path from "node:path";

export const REQUIRED_SERVER_BUNDLE_PROVIDER_LITERALS = [
  "codex",
  "claudeAgent",
  "kiro",
  "amazonQ",
] as const;

const REQUIRED_SERVER_BUNDLE_MARKERS = [
  ...REQUIRED_SERVER_BUNDLE_PROVIDER_LITERALS.map((provider) => ({
    description: `provider literal "${provider}"`,
    pattern: new RegExp(`["']${provider}["']`, "u"),
  })),
  {
    description: 'Kiro CLI marker "kiro-cli"',
    pattern: /kiro-cli/u,
  },
] as const;

export interface RuntimeScriptEntry {
  readonly content: string;
  readonly path: string;
}

function isRuntimeScript(path: string): boolean {
  return /\.(?:c|m)?js$/u.test(path);
}

function collectRuntimeScriptEntriesRecursive(
  directoryPath: string,
  entries: Array<RuntimeScriptEntry>,
): void {
  for (const dirent of FS.readdirSync(directoryPath, { withFileTypes: true })) {
    const entryPath = Path.join(directoryPath, dirent.name);
    if (dirent.isDirectory()) {
      collectRuntimeScriptEntriesRecursive(entryPath, entries);
      continue;
    }
    if (!dirent.isFile() || !isRuntimeScript(entryPath)) {
      continue;
    }
    entries.push({
      content: FS.readFileSync(entryPath, "utf8"),
      path: entryPath,
    });
  }
}

export function readRuntimeScriptEntries(directoryPath: string): ReadonlyArray<RuntimeScriptEntry> {
  const entries: RuntimeScriptEntry[] = [];
  collectRuntimeScriptEntriesRecursive(directoryPath, entries);
  return entries;
}

export function validateDesktopServerBundle(entries: ReadonlyArray<RuntimeScriptEntry>): void {
  if (entries.length === 0) {
    throw new Error("No runtime server scripts found in staged desktop bundle.");
  }

  const combinedContent = entries.map((entry) => entry.content).join("\n");
  const missingMarkers = REQUIRED_SERVER_BUNDLE_MARKERS.filter(
    (marker) => !marker.pattern.test(combinedContent),
  );

  if (missingMarkers.length === 0) {
    return;
  }

  throw new Error(
    [
      "Desktop server bundle validation failed.",
      `Missing markers: ${missingMarkers.map((marker) => marker.description).join(", ")}.`,
      `Checked ${entries.length} runtime scripts.`,
    ].join(" "),
  );
}
