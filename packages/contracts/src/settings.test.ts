import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { DEFAULT_SERVER_SETTINGS, ServerSettings, ServerSettingsPatch } from "./settings";

const decodeServerSettings = Schema.decodeUnknownSync(ServerSettings);
const decodeServerSettingsPatch = Schema.decodeUnknownSync(ServerSettingsPatch);

describe("ServerSettings qualityGate", () => {
  it("defaults project quality checks and maintainability thresholds", () => {
    expect(DEFAULT_SERVER_SETTINGS.qualityGate).toEqual({
      enabled: true,
      format: true,
      lint: true,
      typecheck: true,
      maxFileLines: 500,
      maxFunctionLines: 80,
      maxCyclomaticComplexity: 15,
    });
  });

  it("decodes configurable quality checks and nullable thresholds", () => {
    expect(
      decodeServerSettings({
        qualityGate: {
          enabled: false,
          format: false,
          lint: false,
          maxFileLines: null,
          maxFunctionLines: 120,
          maxCyclomaticComplexity: null,
        },
      }).qualityGate,
    ).toEqual({
      enabled: false,
      format: false,
      lint: false,
      typecheck: true,
      maxFileLines: null,
      maxFunctionLines: 120,
      maxCyclomaticComplexity: null,
    });
  });

  it("accepts partial quality gate patches", () => {
    expect(
      decodeServerSettingsPatch({
        qualityGate: {
          format: false,
          maxFileLines: null,
        },
      }),
    ).toEqual({
      qualityGate: {
        format: false,
        maxFileLines: null,
      },
    });
  });

  it("rejects non-positive quality thresholds", () => {
    expect(() =>
      decodeServerSettings({
        qualityGate: {
          maxFileLines: 0,
        },
      }),
    ).toThrow();
  });
});
