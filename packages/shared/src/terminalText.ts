const OSC_SEQUENCE = new RegExp(String.raw`\u001b\][^\u0007]*(?:\u0007|\u001b\\)`, "g");
const CSI_SEQUENCE = new RegExp(String.raw`(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]`, "g");
const ESCAPE_SEQUENCE = new RegExp(
  String.raw`\u001b(?:[@-Z\\-_]|\([A-Za-z0-9]|\)[A-Za-z0-9]|#[0-9])`,
  "g",
);
const NON_TEXT_CONTROL = new RegExp(
  String.raw`[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]`,
  "g",
);

export function stripTerminalFormatting(value: string): string {
  return value
    .replace(OSC_SEQUENCE, "")
    .replace(CSI_SEQUENCE, "")
    .replace(ESCAPE_SEQUENCE, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(NON_TEXT_CONTROL, "");
}

export function normalizeCliAgentTerminalOutput(value: string): string {
  return stripTerminalPromptMarkers(stripTerminalFormatting(value));
}

function stripTerminalPromptMarkers(value: string): string {
  let inFence = false;
  let fenceMarker: "```" | "~~~" | undefined;

  return value
    .split("\n")
    .map((line) => {
      const trimmedStart = line.trimStart();
      if (trimmedStart.startsWith("```") || trimmedStart.startsWith("~~~")) {
        const marker = trimmedStart.slice(0, 3) as "```" | "~~~";
        if (!inFence) {
          inFence = true;
          fenceMarker = marker;
        } else if (marker === fenceMarker) {
          inFence = false;
          fenceMarker = undefined;
        }
        return line;
      }
      if (inFence) {
        return line;
      }
      return line.replace(/^(?:[ \t]*)> (?=\S)/, "");
    })
    .join("\n");
}
