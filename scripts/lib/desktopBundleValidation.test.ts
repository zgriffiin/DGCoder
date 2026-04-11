import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readRuntimeScriptEntries, validateDesktopServerBundle } from "./desktopBundleValidation";

const tempRoots: string[] = [];

function makeTempDir(): string {
  const dir = FS.mkdtempSync(Path.join(OS.tmpdir(), "t3-desktop-bundle-"));
  tempRoots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    FS.rmSync(dir, { recursive: true, force: true });
  }
});

describe("desktopBundleValidation", () => {
  it("passes when runtime scripts include Kiro-capable provider markers", () => {
    const dir = makeTempDir();
    const runtimePath = Path.join(dir, "index.js");
    FS.writeFileSync(
      runtimePath,
      [
        'const providers = ["codex", "claudeAgent", "kiro", "amazonQ"];',
        'const kiroBinary = "kiro-cli";',
      ].join("\n"),
    );

    expect(() => validateDesktopServerBundle(readRuntimeScriptEntries(dir))).not.toThrow();
  });

  it("fails when Kiro support markers are missing", () => {
    const dir = makeTempDir();
    const runtimePath = Path.join(dir, "index.js");
    FS.writeFileSync(runtimePath, 'const providers = ["codex", "claudeAgent"];');

    expect(() => validateDesktopServerBundle(readRuntimeScriptEntries(dir))).toThrow(
      /Missing markers:/u,
    );
  });
});
