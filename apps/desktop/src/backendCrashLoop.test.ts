import { describe, expect, it } from "vitest";

import {
  BACKEND_CRASH_LOOP_MAX_EXITS,
  BACKEND_HEALTHY_UPTIME_MS,
  BACKEND_CRASH_LOOP_WINDOW_MS,
  createBackendCrashLoopState,
  markBackendHealthy,
  recordUnexpectedBackendExit,
} from "./backendCrashLoop";

describe("backendCrashLoop", () => {
  it("allows restart after one unexpected backend exit", () => {
    const decision = recordUnexpectedBackendExit(createBackendCrashLoopState(), {
      atMs: 1_000,
      lastErrorSnippet: "boot failed",
      pid: 101,
      reason: "code=1 signal=null",
      uptimeMs: 2_000,
    });

    expect(decision.shouldStopRestarting).toBe(false);
    expect(decision.state.unexpectedExits).toHaveLength(1);
  });

  it("resets crash-loop tracking after a healthy uptime window", () => {
    const firstDecision = recordUnexpectedBackendExit(createBackendCrashLoopState(), {
      atMs: 1_000,
      lastErrorSnippet: "first failure",
      pid: 101,
      reason: "code=1 signal=null",
      uptimeMs: 2_000,
    });

    const secondDecision = recordUnexpectedBackendExit(firstDecision.state, {
      atMs: 2_000,
      lastErrorSnippet: "healthy failure",
      pid: 102,
      reason: "code=1 signal=null",
      uptimeMs: BACKEND_HEALTHY_UPTIME_MS + 1,
    });

    expect(secondDecision.shouldStopRestarting).toBe(false);
    expect(secondDecision.state.unexpectedExits).toHaveLength(0);
  });

  it("stops restarting after three fast exits within the crash window", () => {
    let state = createBackendCrashLoopState();
    let shouldStopRestarting = false;

    for (let index = 0; index < BACKEND_CRASH_LOOP_MAX_EXITS; index += 1) {
      const decision = recordUnexpectedBackendExit(state, {
        atMs: 1_000 + index * 5_000,
        lastErrorSnippet: `failure-${index + 1}`,
        pid: 200 + index,
        reason: "code=1 signal=null",
        uptimeMs: 4_000,
      });
      state = decision.state;
      shouldStopRestarting = decision.shouldStopRestarting;
    }

    expect(shouldStopRestarting).toBe(true);
    expect(state.unexpectedExits).toHaveLength(BACKEND_CRASH_LOOP_MAX_EXITS);
  });

  it("drops stale exits outside the crash loop window", () => {
    const firstDecision = recordUnexpectedBackendExit(createBackendCrashLoopState(), {
      atMs: 1_000,
      lastErrorSnippet: "stale failure",
      pid: 101,
      reason: "code=1 signal=null",
      uptimeMs: 1_000,
    });

    const secondDecision = recordUnexpectedBackendExit(firstDecision.state, {
      atMs: 1_000 + BACKEND_CRASH_LOOP_WINDOW_MS + 1,
      lastErrorSnippet: "new failure",
      pid: 102,
      reason: "code=1 signal=null",
      uptimeMs: 1_000,
    });

    expect(secondDecision.shouldStopRestarting).toBe(false);
    expect(secondDecision.state.unexpectedExits).toHaveLength(1);
    expect(secondDecision.state.unexpectedExits[0]?.lastErrorSnippet).toBe("new failure");
  });

  it("clears tracked exits when the backend is marked healthy", () => {
    const decision = recordUnexpectedBackendExit(createBackendCrashLoopState(), {
      atMs: 1_000,
      lastErrorSnippet: "boot failed",
      pid: 101,
      reason: "code=1 signal=null",
      uptimeMs: 2_000,
    });

    expect(markBackendHealthy(decision.state).unexpectedExits).toHaveLength(0);
  });
});
