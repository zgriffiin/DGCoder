export type BackendLogStreamName = "stderr" | "stdout";

export interface BackendLogTailState {
  readonly lines: ReadonlyArray<string>;
  readonly maxLines: number;
  readonly pendingByStream: Readonly<Record<BackendLogStreamName, string>>;
}

function trimToMaxLines(lines: ReadonlyArray<string>, maxLines: number): ReadonlyArray<string> {
  return lines.length <= maxLines ? lines : lines.slice(-maxLines);
}

function normalizeChunk(chunk: unknown, encoding?: BufferEncoding): string {
  if (Buffer.isBuffer(chunk)) {
    return chunk.toString(encoding);
  }

  return typeof chunk === "string" ? chunk : String(chunk);
}

export function createBackendLogTailState(maxLines: number): BackendLogTailState {
  return {
    lines: [],
    maxLines,
    pendingByStream: {
      stderr: "",
      stdout: "",
    },
  };
}

export function appendBackendLogTailChunk(
  state: BackendLogTailState,
  streamName: BackendLogStreamName,
  chunk: unknown,
  encoding?: BufferEncoding,
): BackendLogTailState {
  const text = `${state.pendingByStream[streamName]}${normalizeChunk(chunk, encoding)}`;
  const normalizedText = text.replace(/\r\n/g, "\n");
  const fragments = normalizedText.split("\n");
  const pending = fragments.pop() ?? "";
  const nextLines = fragments.map((line) => `[${streamName}] ${line}`);

  return {
    ...state,
    lines: trimToMaxLines([...state.lines, ...nextLines], state.maxLines),
    pendingByStream: {
      ...state.pendingByStream,
      [streamName]: pending,
    },
  };
}

export function readBackendLogTail(
  state: BackendLogTailState,
  options?: {
    readonly includePending?: boolean;
  },
): string {
  const includePending = options?.includePending ?? true;
  if (!includePending) {
    return state.lines.join("\n");
  }

  const pendingLines: string[] = [];
  if (state.pendingByStream.stdout.length > 0) {
    pendingLines.push(`[stdout] ${state.pendingByStream.stdout}`);
  }
  if (state.pendingByStream.stderr.length > 0) {
    pendingLines.push(`[stderr] ${state.pendingByStream.stderr}`);
  }

  return [...state.lines, ...pendingLines].join("\n");
}
