import { describe, expect, it } from "vitest";

import {
  appendResponseStyleToDeveloperInstructions,
  applyResponseStyleToTurnInput,
} from "./responseStyle";

describe("responseStyle", () => {
  it("defaults to full-style overlay wording for turn inputs", () => {
    expect(applyResponseStyleToTurnInput("Explain bug", "full")).toContain(
      "[Response style: Caveman] Use Caveman Full.",
    );
  });

  it("leaves turn input untouched when style is off", () => {
    expect(applyResponseStyleToTurnInput("Explain bug", "off")).toBe("Explain bug");
  });

  it("does not inject prompt text into image-only turns", () => {
    expect(applyResponseStyleToTurnInput(undefined, "ultra")).toBeUndefined();
    expect(applyResponseStyleToTurnInput("   ", "ultra")).toBe("   ");
  });

  it("appends style guidance to developer instructions", () => {
    expect(appendResponseStyleToDeveloperInstructions("Base instructions", "lite")).toContain(
      "Base instructions\n\n[Response style: Caveman] Use Caveman Lite.",
    );
  });
});
