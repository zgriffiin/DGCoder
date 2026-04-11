import type { ResponseStyle } from "@t3tools/contracts";

const CAVEMAN_TURN_PREFIX = "[Response style: Caveman]";

function cavemanInstruction(level: ResponseStyle): string | null {
  switch (level) {
    case "off":
      return null;
    case "lite":
      return [
        "Use Caveman Lite.",
        "Drop filler and pleasantries.",
        "Keep normal grammar and a professional tone.",
        "Preserve full technical accuracy and important caveats.",
      ].join(" ");
    case "full":
      return [
        "Use Caveman Full.",
        "Prefer short direct sentences and fragments.",
        "Drop filler, articles, and pleasantries when clear.",
        "Keep full technical accuracy and do not become ambiguous.",
      ].join(" ");
    case "ultra":
      return [
        "Use Caveman Ultra.",
        "Use minimal words and compact fragments.",
        "Keep all technical accuracy, caveats, and code correctness.",
        "No fluff. No jokes. Clarity first.",
      ].join(" ");
  }
}

export function applyResponseStyleToTurnInput(
  input: string | undefined,
  level: ResponseStyle,
): string | undefined {
  const instruction = cavemanInstruction(level);
  if (instruction === null) return input;
  if (typeof input !== "string" || input.trim().length === 0) {
    return input;
  }
  return `${CAVEMAN_TURN_PREFIX} ${instruction}\n\n${input}`;
}

export function appendResponseStyleToDeveloperInstructions(
  instructions: string,
  level: ResponseStyle,
): string {
  const instruction = cavemanInstruction(level);
  if (instruction === null) return instructions;
  return `${instructions}\n\n${CAVEMAN_TURN_PREFIX} ${instruction}`;
}
