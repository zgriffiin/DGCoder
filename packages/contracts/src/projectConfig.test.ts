import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCAL_REVIEW_ENFORCE_ON,
  DEFAULT_LOCAL_REVIEW_TIMEOUT_MS,
  T3CodeProjectConfig,
} from "./projectConfig";

const decodeProjectConfig = Schema.decodeUnknownSync(T3CodeProjectConfig);

describe("T3CodeProjectConfig", () => {
  it("applies local review defaults", () => {
    const parsed = decodeProjectConfig({
      version: 1,
      localReview: {
        tool: "coderabbit",
        command: "coderabbit",
        args: ["review", "--plain"],
      },
    });

    expect(parsed.localReview?.enforceOn).toEqual([...DEFAULT_LOCAL_REVIEW_ENFORCE_ON]);
    expect(parsed.localReview?.timeoutMs).toBe(DEFAULT_LOCAL_REVIEW_TIMEOUT_MS);
  });

  it("rejects unsupported local review tools", () => {
    expect(() =>
      decodeProjectConfig({
        version: 1,
        localReview: {
          tool: "other",
          command: "other",
          args: [],
        },
      }),
    ).toThrow();
  });
});
