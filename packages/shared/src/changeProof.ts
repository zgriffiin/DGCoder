export interface ChangeProof {
  readonly intent: string;
  readonly validationCommands: ReadonlyArray<string>;
}

export interface ParsedCommitChangeProof {
  readonly subject: string;
  readonly body: string;
  readonly descriptiveBody: string;
  readonly intent: string | null;
  readonly validationCommands: ReadonlyArray<string>;
}

function normalizeMultilineText(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .trim()
    .replace(/\n{3,}/g, "\n\n");
}

function normalizeValidationLine(value: string): string {
  return value.replace(/^\s*[-*]\s*/, "").trim();
}

export function normalizeValidationCommands(
  value: ReadonlyArray<string> | string,
): ReadonlyArray<string> {
  let lines: ReadonlyArray<string>;
  if (typeof value === "string") {
    lines = value.replace(/\r\n/g, "\n").split("\n");
  } else {
    lines = value;
  }
  return lines
    .map((line: string) => normalizeValidationLine(line))
    .filter((line) => line.length > 0);
}

export function formatChangeProofBlock(input: ChangeProof): string {
  const intent = normalizeMultilineText(input.intent);
  const validationCommands = normalizeValidationCommands(input.validationCommands);
  const sections: string[] = [];

  if (intent.length > 0) {
    sections.push("Intent:", intent);
  }
  if (validationCommands.length > 0) {
    if (sections.length > 0) {
      sections.push("");
    }
    sections.push("Validation:", ...validationCommands.map((command) => `- ${command}`));
  }

  return sections.join("\n");
}

export function appendChangeProofToCommitBody(body: string, input: ChangeProof): string {
  const trimmedBody = normalizeMultilineText(body);
  const proofBlock = formatChangeProofBlock(input);
  return trimmedBody.length > 0 ? `${trimmedBody}\n\n${proofBlock}` : proofBlock;
}

function stripProofSection(body: string, pattern: RegExp): string {
  return normalizeMultilineText(body.replace(pattern, "\n").trim());
}

export function parseCommitChangeProof(commitMessage: string): ParsedCommitChangeProof {
  const normalizedMessage = commitMessage.replace(/\r\n/g, "\n").trim();
  if (normalizedMessage.length === 0) {
    return {
      subject: "",
      body: "",
      descriptiveBody: "",
      intent: null,
      validationCommands: [],
    };
  }

  const [subject = "", ...rest] = normalizedMessage.split("\n");
  const body = normalizeMultilineText(rest.join("\n"));
  const intentPattern = /(?:^|\n)Intent:\s*([\s\S]*?)(?=\nValidation:\s*|$)/i;
  const validationPattern = /(?:^|\n)Validation:\s*([\s\S]*?)$/i;
  const intentMatch = body.match(intentPattern);
  const validationMatch = body.match(validationPattern);
  const intent = intentMatch?.[1] ? normalizeMultilineText(intentMatch[1]) : null;
  const validationCommands = validationMatch?.[1]
    ? normalizeValidationCommands(validationMatch[1])
    : [];

  let descriptiveBody = body;
  if (intentMatch) {
    descriptiveBody = stripProofSection(descriptiveBody, intentPattern);
  }
  if (validationMatch) {
    descriptiveBody = stripProofSection(descriptiveBody, validationPattern);
  }

  return {
    subject: subject.trim(),
    body,
    descriptiveBody,
    intent,
    validationCommands,
  };
}
