import { RotatingFileSink } from "@t3tools/shared/logging";
import { Effect } from "effect";

import type { TraceRecord } from "./TraceRecord.ts";

const FLUSH_BUFFER_THRESHOLD = 32;
const DEFAULT_MAX_IN_MEMORY_TRACE_BACKLOG_BYTES = 512 * 1024;

function chunkBytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export interface TraceSinkOptions {
  readonly filePath: string;
  readonly maxBytes: number;
  readonly maxFiles: number;
  readonly batchWindowMs: number;
  readonly maxBacklogBytes?: number;
}

export interface TraceSink {
  readonly filePath: string;
  push: (record: TraceRecord) => void;
  flush: Effect.Effect<void>;
  close: () => Effect.Effect<void>;
}

export const makeTraceSink = Effect.fn("makeTraceSink")(function* (options: TraceSinkOptions) {
  const sink = new RotatingFileSink({
    filePath: options.filePath,
    maxBytes: options.maxBytes,
    maxFiles: options.maxFiles,
  });

  let buffer: Array<string> = [];
  let bufferBytes = 0;
  let backlogWarningEmitted = false;
  const maxBacklogBytes = options.maxBacklogBytes ?? DEFAULT_MAX_IN_MEMORY_TRACE_BACKLOG_BYTES;

  const emitBacklogWarning = (reason: "record" | "flush-failure", droppedBytes: number) => {
    if (backlogWarningEmitted) {
      return;
    }
    backlogWarningEmitted = true;
    console.warn("[trace-sink] dropping trace backlog after hitting memory cap", {
      filePath: options.filePath,
      reason,
      droppedBytes,
      maxBacklogBytes,
    });
  };

  const enqueueBufferedChunk = (
    value: string,
    reason: "record" | "flush-failure",
    position: "append" | "prepend" = "append",
  ): boolean => {
    const bytes = chunkBytes(value);
    if (bytes > maxBacklogBytes || bufferBytes + bytes > maxBacklogBytes) {
      emitBacklogWarning(reason, bytes);
      return false;
    }
    if (position === "prepend") {
      buffer.unshift(value);
    } else {
      buffer.push(value);
    }
    bufferBytes += bytes;
    return true;
  };

  const flushUnsafe = () => {
    if (buffer.length === 0) {
      return;
    }

    const chunk = buffer.join("");
    buffer = [];
    bufferBytes = 0;

    try {
      sink.write(chunk);
      backlogWarningEmitted = false;
    } catch {
      enqueueBufferedChunk(chunk, "flush-failure", "prepend");
    }
  };

  const flush = Effect.sync(flushUnsafe).pipe(Effect.withTracerEnabled(false));

  yield* Effect.addFinalizer(() => flush.pipe(Effect.ignore));
  yield* Effect.forkScoped(
    Effect.sleep(`${options.batchWindowMs} millis`).pipe(Effect.andThen(flush), Effect.forever),
  );

  return {
    filePath: options.filePath,
    push(record) {
      try {
        if (!enqueueBufferedChunk(`${JSON.stringify(record)}\n`, "record")) {
          return;
        }
        if (buffer.length >= FLUSH_BUFFER_THRESHOLD) {
          flushUnsafe();
        }
      } catch {
        return;
      }
    },
    flush,
    close: () => flush,
  } satisfies TraceSink;
});
