import { describe, expect, it } from "vitest";

import {
  appendBackendLogTailChunk,
  createBackendLogTailState,
  readBackendLogTail,
} from "./backendLogTail";

describe("backendLogTail", () => {
  it("keeps only the latest lines within the configured limit", () => {
    let state = createBackendLogTailState(2);
    state = appendBackendLogTailChunk(state, "stdout", "first\nsecond\nthird\n");

    expect(readBackendLogTail(state)).toBe("[stdout] second\n[stdout] third");
  });

  it("preserves partial lines across chunks", () => {
    let state = createBackendLogTailState(5);
    state = appendBackendLogTailChunk(state, "stderr", "partial");
    state = appendBackendLogTailChunk(state, "stderr", " line\nnext line");

    expect(readBackendLogTail(state)).toBe("[stderr] partial line\n[stderr] next line");
  });

  it("tracks stdout and stderr tails independently", () => {
    let state = createBackendLogTailState(5);
    state = appendBackendLogTailChunk(state, "stdout", "out-1");
    state = appendBackendLogTailChunk(state, "stderr", "err-1");
    state = appendBackendLogTailChunk(state, "stdout", "\nout-2\n");

    expect(readBackendLogTail(state)).toBe("[stdout] out-1\n[stdout] out-2\n[stderr] err-1");
  });

  it("can omit pending lines when requested", () => {
    let state = createBackendLogTailState(5);
    state = appendBackendLogTailChunk(state, "stdout", "line-1\nline-2");

    expect(readBackendLogTail(state, { includePending: false })).toBe("[stdout] line-1");
  });
});
