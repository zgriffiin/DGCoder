import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

const WORKSPACE_TYPECHECK_DIRS = [
  "packages/contracts",
  "apps/marketing",
  "packages/client-runtime",
  "packages/shared",
  "scripts",
  "apps/desktop",
  "apps/web",
  "apps/server",
];

function readPackageName(packageDir) {
  const packageJsonPath = path.join(repoRoot, packageDir, "package.json");
  const raw = readFileSync(packageJsonPath, "utf8");
  const parsed = JSON.parse(raw);
  return typeof parsed.name === "string" && parsed.name.length > 0 ? parsed.name : packageDir;
}

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

  if (path.basename(process.execPath).toLowerCase().startsWith("bun")) {
    return process.execPath;
  }

  const homeDir = process.env.USERPROFILE ?? process.env.HOME ?? null;
  if (homeDir) {
    const homeCandidate = path.join(
      homeDir,
      ".bun",
      "bin",
      process.platform === "win32" ? "bun.exe" : "bun",
    );
    if (isExistingFile(homeCandidate)) {
      return homeCandidate;
    }
  }

  const bunInstall = process.env.BUN_INSTALL;
  if (bunInstall) {
    const bunInstallCandidate = path.join(
      bunInstall,
      "bin",
      process.platform === "win32" ? "bun.exe" : "bun",
    );
    if (isExistingFile(bunInstallCandidate)) {
      return bunInstallCandidate;
    }
  }

  return null;
}

function prependPathEntries(env, entries) {
  const delimiter = path.delimiter;
  const existingEntries = (env.PATH ?? "").split(delimiter).filter((entry) => entry.length > 0);
  env.PATH = [...new Set([...entries, ...existingEntries])].join(delimiter);
}

const bunBinaryPath = findBunBinaryPath();
if (!bunBinaryPath) {
  console.error("Unable to locate the Bun binary required for workspace typecheck.");
  process.exit(1);
}

const childEnv = { ...process.env };
prependPathEntries(childEnv, [path.dirname(bunBinaryPath)]);
childEnv.npm_execpath = bunBinaryPath;

for (const packageDir of WORKSPACE_TYPECHECK_DIRS) {
  const packageName = readPackageName(packageDir);
  console.log(`${packageName}:typecheck: $ bun run typecheck`);
  const result = spawnSync(bunBinaryPath, ["run", "typecheck"], {
    cwd: path.join(repoRoot, packageDir),
    env: childEnv,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}
