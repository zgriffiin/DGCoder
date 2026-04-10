import { describe, expect, it } from "vitest";

import {
  buildCliAgentLoginCommand,
  resolveCliAgentCommand,
  windowsPathToWslPath,
} from "./cliAgentCommand";

describe("windowsPathToWslPath", () => {
  it("converts Windows drive paths to WSL mount paths", () => {
    expect(windowsPathToWslPath("C:\\Users\\dgriffin3\\DGCoder")).toBe(
      "/mnt/c/Users/dgriffin3/DGCoder",
    );
    expect(windowsPathToWslPath("D:/work/project")).toBe("/mnt/d/work/project");
    expect(windowsPathToWslPath("/home/user/project")).toBe("/home/user/project");
  });
});

describe("resolveCliAgentCommand", () => {
  it("builds host commands with the platform shell behavior", () => {
    expect(
      resolveCliAgentCommand({ binaryPath: "kiro-cli", executionMode: "host" }, ["--version"], {
        cwd: "C:\\repo",
        platform: "win32",
      }),
    ).toEqual({
      command: "kiro-cli",
      args: ["--version"],
      cwd: "C:\\repo",
      shell: true,
      display: "kiro-cli --version",
    });
  });

  it("wraps commands in wsl.exe on Windows", () => {
    expect(
      resolveCliAgentCommand(
        { binaryPath: "kiro-cli", executionMode: "wsl", wslDistro: "Ubuntu" },
        ["chat", "--no-interactive", "Inspect the workspace"],
        { cwd: "C:\\Users\\dgriffin3\\DGCoder", platform: "win32" },
      ),
    ).toEqual({
      command: "wsl.exe",
      args: [
        "-d",
        "Ubuntu",
        "--cd",
        "/mnt/c/Users/dgriffin3/DGCoder",
        "--exec",
        "bash",
        "-lc",
        'exec "$@"',
        "bash",
        "kiro-cli",
        "chat",
        "--no-interactive",
        "Inspect the workspace",
      ],
      shell: false,
      display:
        'wsl.exe -d Ubuntu --cd /mnt/c/Users/dgriffin3/DGCoder --exec bash -lc "exec \\"$@\\"" bash kiro-cli chat --no-interactive "Inspect the workspace"',
    });
  });

  it("uses WSL for auto mode on Windows", () => {
    expect(
      resolveCliAgentCommand({ binaryPath: "kiro-cli", executionMode: "auto" }, ["--version"], {
        platform: "win32",
      }),
    ).toMatchObject({
      command: "wsl.exe",
      args: ["--exec", "bash", "-lc", 'exec "$@"', "bash", "kiro-cli", "--version"],
      shell: false,
    });
  });

  it("uses host execution for auto mode off Windows", () => {
    expect(
      resolveCliAgentCommand({ binaryPath: "kiro-cli", executionMode: "auto" }, ["--version"], {
        platform: "linux",
      }),
    ).toMatchObject({
      command: "kiro-cli",
      args: ["--version"],
      shell: false,
    });
  });

  it("builds login command previews from the same resolver", () => {
    expect(
      buildCliAgentLoginCommand(
        {
          binaryPath: "kiro-cli",
          executionMode: "wsl",
        },
        { platform: "win32" },
      ),
    ).toBe('wsl.exe --exec bash -lc "exec \\"$@\\"" bash kiro-cli login');
  });
});
