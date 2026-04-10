import { describe, expect, it } from "vitest";

import { normalizeCliAgentTerminalOutput, stripTerminalFormatting } from "./terminalText";

describe("stripTerminalFormatting", () => {
  it("removes ANSI color escape sequences from CLI output", () => {
    expect(stripTerminalFormatting("\x1b[38;5;14m> \x1b[0mKiro response")).toBe("> Kiro response");
  });

  it("removes OSC terminal sequences and preserves readable text", () => {
    expect(stripTerminalFormatting("open \x1b]8;;https://example.com\x07link\x1b]8;;\x07")).toBe(
      "open link",
    );
  });

  it("normalizes carriage returns and drops non-text controls", () => {
    expect(stripTerminalFormatting("first\rsecond\x07\nthird")).toBe("first\nsecond\nthird");
  });
});

describe("normalizeCliAgentTerminalOutput", () => {
  it("removes colored CLI prompt markers before assistant prose", () => {
    expect(
      normalizeCliAgentTerminalOutput(
        "\x1b[38;5;14m> \x1b[0mI'm running in WSL.\n\n> Here's the rundown:",
      ),
    ).toBe("I'm running in WSL.\n\nHere's the rundown:");
  });

  it("keeps prompt-like content inside fenced code blocks", () => {
    expect(normalizeCliAgentTerminalOutput("```md\n> quoted\n```\n> prose")).toBe(
      "```md\n> quoted\n```\nprose",
    );
  });
});
