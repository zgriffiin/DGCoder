import { describe, expect, it } from "vitest";

import type { ModelSelection, PiRuntimeSnapshot, ServerProvider } from "@t3tools/contracts";

import { mergeProviderStatuses, resolvePiModelSelection } from "./piThreadBridge";

const baseSnapshot: PiRuntimeSnapshot = {
  providers: [
    {
      provider: "openai-codex",
      totalModels: 2,
      availableModels: 0,
    },
  ],
  models: [
    {
      provider: "openai-codex",
      id: "gpt-5.4",
      name: "gpt-5.4",
      reasoning: true,
      input: ["text"],
      contextWindow: 272_000,
      maxTokens: 32_000,
      authConfigured: false,
    },
    {
      provider: "openai-codex",
      id: "gpt-5.4-mini",
      name: "GPT-5.4 Mini",
      reasoning: true,
      input: ["text"],
      contextWindow: 272_000,
      maxTokens: 32_000,
      authConfigured: false,
    },
  ],
  configuredModelCount: 0,
  authFilePath: "C:\\Users\\dgriffin3\\.t3\\userdata\\pi\\auth.json",
};

describe("resolvePiModelSelection", () => {
  it("keeps the selected unauthenticated Pi model so the runtime can return provider-specific auth guidance", () => {
    const selection: ModelSelection = {
      provider: "codex",
      model: "gpt-5.4",
    };

    expect(resolvePiModelSelection(baseSnapshot, selection)).toEqual({
      provider: "openai-codex",
      modelId: "gpt-5.4",
    });
  });

  it("falls back to the first known Pi model when nothing is authenticated yet", () => {
    expect(resolvePiModelSelection(baseSnapshot, null)).toEqual({
      provider: "openai-codex",
      modelId: "gpt-5.4",
    });
  });

  it("returns null for providers that are not Pi-backed", () => {
    const selection: ModelSelection = {
      provider: "kiro",
      model: "default",
    };

    expect(resolvePiModelSelection(baseSnapshot, selection)).toBeNull();
  });
});

describe("mergeProviderStatuses", () => {
  it("keeps CLI-backed providers while overriding Pi-backed providers with Pi runtime status", () => {
    const serverProviders: ServerProvider[] = [
      {
        provider: "codex",
        enabled: true,
        installed: true,
        version: "legacy",
        status: "warning",
        auth: { status: "unknown" },
        checkedAt: "2026-04-13T00:00:00.000Z",
        models: [],
      },
      {
        provider: "kiro",
        enabled: true,
        installed: true,
        version: "1.2.3",
        status: "ready",
        auth: { status: "authenticated", label: "IAM Identity Center" },
        checkedAt: "2026-04-13T00:00:00.000Z",
        models: [],
      },
    ];

    const piProviders: ServerProvider[] = [
      {
        provider: "codex",
        enabled: true,
        installed: true,
        version: null,
        status: "ready",
        auth: { status: "authenticated", label: "openai-codex" },
        checkedAt: "2026-04-13T00:00:01.000Z",
        models: [],
      },
    ];

    expect(mergeProviderStatuses(serverProviders, piProviders)).toEqual([
      piProviders[0],
      serverProviders[1],
    ]);
  });
});
