import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runProcess } from "./processRunner";

describe("runProcess", () => {
  it("preserves spaced and empty arguments", async () => {
    const result = await runProcess("node", [
      "-e",
      "process.stdout.write(JSON.stringify(process.argv.slice(1)))",
      "--",
      "--title",
      "Amazon Q and Kiro support",
      "--priority",
      "",
      "--body",
      "Intent: keep spaces and punctuation.",
    ]);

    expect(JSON.parse(result.stdout)).toEqual([
      "--title",
      "Amazon Q and Kiro support",
      "--priority",
      "",
      "--body",
      "Intent: keep spaces and punctuation.",
    ]);
  });

  it("fails when output exceeds max buffer in default mode", async () => {
    await expect(
      runProcess("node", ["-e", "process.stdout.write('x'.repeat(2048))"], { maxBufferBytes: 128 }),
    ).rejects.toThrow("exceeded stdout buffer limit");
  });

  it("truncates output when outputMode is truncate", async () => {
    const result = await runProcess("node", ["-e", "process.stdout.write('x'.repeat(2048))"], {
      maxBufferBytes: 128,
      outputMode: "truncate",
    });

    expect(result.code).toBe(0);
    expect(result.stdout.length).toBeLessThanOrEqual(128);
    expect(result.stdoutTruncated).toBe(true);
    expect(result.stderrTruncated).toBe(false);
  });

  it("runs bun scripts without shell wrapping", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "t3-process-runner-"));
    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify(
        {
          name: "process-runner-bun-test",
          private: true,
          scripts: {
            typecheck: 'node -e "process.stdout.write(process.platform)"',
          },
        },
        null,
        2,
      ),
    );

    const result = await runProcess("bun", ["run", "typecheck"], {
      cwd: tempDir,
    });

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toContain(process.platform);
  });
});
