import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildLocalReviewCommandPreview,
  loadT3CodeProjectConfig,
  parseT3CodeProjectConfigText,
  resolveT3CodeProjectConfigPath,
  substituteLocalReviewArgs,
} from "./projectConfig";

describe("projectConfig helpers", () => {
  it("loads a valid project config and applies defaults", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "t3code-project-config-"));
    const configPath = resolveT3CodeProjectConfigPath(cwd);
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        version: 1,
        localReview: {
          tool: "coderabbit",
          command: "coderabbit",
          args: ["review", "--base", "{{defaultBranch}}"],
        },
      }),
    );

    const result = loadT3CodeProjectConfig(cwd);
    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") {
      throw new Error("Expected loaded config.");
    }
    expect(result.config.localReview?.enforceOn).toEqual([
      "commit_push",
      "commit_push_pr",
      "create_pr",
    ]);
    expect(result.config.localReview?.timeoutMs).toBe(300_000);
  });

  it("returns missing when the config file is absent", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "t3code-project-config-missing-"));
    expect(loadT3CodeProjectConfig(cwd)).toMatchObject({
      status: "missing",
      configPath: resolveT3CodeProjectConfigPath(cwd),
    });
  });

  it("returns invalid for malformed JSON", () => {
    const result = parseT3CodeProjectConfigText({
      configPath: "/repo/.t3code/project.json",
      text: "{",
    });

    expect(result.status).toBe("invalid");
  });

  it("rejects unsupported template tokens", () => {
    const result = parseT3CodeProjectConfigText({
      configPath: "/repo/.t3code/project.json",
      text: JSON.stringify({
        version: 1,
        localReview: {
          tool: "coderabbit",
          command: "coderabbit",
          args: ["review", "--base", "{{unknownToken}}"],
        },
      }),
    });

    expect(result).toMatchObject({
      status: "invalid",
    });
  });

  it("substitutes the default branch token", () => {
    expect(
      substituteLocalReviewArgs(["review", "--base", "{{defaultBranch}}"], {
        defaultBranch: "main",
      }),
    ).toEqual(["review", "--base", "main"]);
  });

  it("builds a human-readable command preview", () => {
    expect(
      buildLocalReviewCommandPreview("coderabbit", [
        "review",
        "--base",
        "{{defaultBranch}}",
        "-c",
        "docs/coderabbit-review.md",
      ]),
    ).toBe("coderabbit review --base {{defaultBranch}} -c docs/coderabbit-review.md");
  });
});
