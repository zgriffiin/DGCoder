import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const turboBinPath = path.join(repoRoot, "node_modules", "turbo", "bin", "turbo");

function isExistingFile(candidate) {
  return typeof candidate === "string" && candidate.length > 0 && existsSync(candidate);
}

function findBunBinaryPath() {
  const envCandidates = [
    process.env.npm_execpath,
    process.env.npm_node_execpath,
    process.env.BUN,
    process.env.BUN_BINARY,
  ];
  for (const candidate of envCandidates) {
    if (isExistingFile(candidate)) {
      return candidate;
    }
  }

  const execPath =
    typeof process.execPath === "string" && process.execPath.length > 0 ? process.execPath : null;
  if (execPath && path.basename(execPath).toLowerCase().startsWith("bun")) {
    return execPath;
  }

  const bunInstall = process.env.BUN_INSTALL;
  if (typeof bunInstall === "string" && bunInstall.length > 0) {
    const platformBinary = process.platform === "win32" ? "bun.exe" : "bun";
    const installedPath = path.join(bunInstall, "bin", platformBinary);
    if (isExistingFile(installedPath)) {
      return installedPath;
    }
  }

  return null;
}

function prependPathEntries(env, entries) {
  const delimiter = path.delimiter;
  const existingEntries = (env.PATH ?? "").split(delimiter).filter((entry) => entry.length > 0);
  const nextEntries = [...entries, ...existingEntries];
  env.PATH = [...new Set(nextEntries)].join(delimiter);
}

if (!isExistingFile(turboBinPath)) {
  console.error(`Turbo entrypoint not found at ${turboBinPath}`);
  process.exit(1);
}

const bunBinaryPath = findBunBinaryPath();
const childEnv = { ...process.env };
if (bunBinaryPath) {
  prependPathEntries(childEnv, [path.dirname(bunBinaryPath)]);
  if (!childEnv.npm_execpath) {
    childEnv.npm_execpath = bunBinaryPath;
  }
}

const turboArgs = process.argv.slice(2);
const result = spawnSync(process.execPath, [turboBinPath, ...turboArgs], {
  cwd: repoRoot,
  env: childEnv,
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
