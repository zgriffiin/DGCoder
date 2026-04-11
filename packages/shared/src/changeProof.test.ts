import { describe, expect, it } from "vitest";

import {
  appendChangeProofToCommitBody,
  formatChangeProofBlock,
  normalizeValidationCommands,
  parseCommitChangeProof,
} from "./changeProof";

describe("normalizeValidationCommands", () => {
  it("normalizes multiline command input into trimmed commands", () => {
    expect(normalizeValidationCommands(" bun run test \n\n- bun run typecheck\n")).toEqual([
      "bun run test",
      "bun run typecheck",
    ]);
  });
});

describe("formatChangeProofBlock", () => {
  it("formats intent and validation commands into a commit-proof block", () => {
    expect(
      formatChangeProofBlock({
        intent: "Prove commit and push actions carry rationale.",
        validationCommands: ["bun run test apps/web", "bun run typecheck"],
      }),
    ).toBe(
      [
        "Intent:",
        "Prove commit and push actions carry rationale.",
        "",
        "Validation:",
        "- bun run test apps/web",
        "- bun run typecheck",
      ].join("\n"),
    );
  });
});

describe("appendChangeProofToCommitBody", () => {
  it("appends the proof block after any existing body text", () => {
    expect(
      appendChangeProofToCommitBody("Context paragraph.", {
        intent: "Protect outgoing commits.",
        validationCommands: ["bun run test"],
      }),
    ).toBe(
      [
        "Context paragraph.",
        "",
        "Intent:",
        "Protect outgoing commits.",
        "",
        "Validation:",
        "- bun run test",
      ].join("\n"),
    );
  });
});

describe("parseCommitChangeProof", () => {
  it("extracts intent and validation commands from a formatted commit message", () => {
    const parsed = parseCommitChangeProof(
      [
        "feat: enforce change proof",
        "",
        "Additional context for reviewers.",
        "",
        "Intent:",
        "Block commits that do not say why.",
        "",
        "Validation:",
        "- bun run test apps/server",
        "- bun run typecheck",
      ].join("\n"),
    );

    expect(parsed.subject).toBe("feat: enforce change proof");
    expect(parsed.intent).toBe("Block commits that do not say why.");
    expect(parsed.validationCommands).toEqual(["bun run test apps/server", "bun run typecheck"]);
    expect(parsed.descriptiveBody).toBe("Additional context for reviewers.");
  });

  it("returns empty proof fields when the commit message lacks the proof block", () => {
    expect(parseCommitChangeProof("chore: touch docs")).toEqual({
      subject: "chore: touch docs",
      body: "",
      descriptiveBody: "",
      intent: null,
      validationCommands: [],
    });
  });
});
