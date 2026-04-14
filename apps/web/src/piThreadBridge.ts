import {
  type ModelSelection,
  type PiRuntimeSnapshot,
  type PiThreadSnapshot,
  type ProviderKind,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import type { ChatMessage, ThreadSession } from "./types";

export const PI_THREAD_BINDINGS_STORAGE_KEY = "dgcode:pi-thread-bindings:v1";
export const PiThreadBindingsSchema = Schema.Record(Schema.String, Schema.String);
export type PiThreadBindings = typeof PiThreadBindingsSchema.Type;

function mapPiProviderToLegacyProvider(provider: string | null | undefined): ProviderKind | null {
  switch (provider) {
    case "openai-codex":
      return "codex";
    case "anthropic":
      return "claudeAgent";
    default:
      return null;
  }
}

export function isPiBackedProvider(provider: ProviderKind): boolean {
  return provider === "codex" || provider === "claudeAgent";
}

export function buildPiProviderStatuses(
  snapshot: PiRuntimeSnapshot | null,
): ReadonlyArray<ServerProvider> {
  if (!snapshot) {
    return [];
  }

  const checkedAt = new Date().toISOString();
  const grouped = new Map<ProviderKind, ServerProvider>();

  for (const model of snapshot.models) {
    const provider = mapPiProviderToLegacyProvider(model.provider);
    if (!provider) {
      continue;
    }

    const existing = grouped.get(provider);
    const nextModel = {
      slug: model.id,
      name: model.name,
      isCustom: false,
      capabilities: null,
    } as const;

    if (existing) {
      grouped.set(provider, {
        ...existing,
        auth: model.authConfigured
          ? {
              status: "authenticated",
              type: "pi",
              label: model.provider,
            }
          : existing.auth,
        status: existing.status === "ready" || model.authConfigured ? "ready" : existing.status,
        models: [...existing.models, nextModel],
      });
      continue;
    }

    grouped.set(provider, {
      provider,
      enabled: true,
      installed: true,
      version: null,
      status: model.authConfigured ? "ready" : "warning",
      auth: model.authConfigured
        ? {
            status: "authenticated",
            type: "pi",
            label: model.provider,
          }
        : {
            status: "unauthenticated",
            type: "pi",
            label: model.provider,
          },
      checkedAt,
      ...(snapshot.loadError ? { message: snapshot.loadError } : {}),
      models: [nextModel],
    });
  }

  return [...grouped.values()];
}

export function mergeProviderStatuses(
  serverProviders: ReadonlyArray<ServerProvider>,
  piProviders: ReadonlyArray<ServerProvider>,
): ReadonlyArray<ServerProvider> {
  const merged = new Map(serverProviders.map((provider) => [provider.provider, provider]));
  for (const provider of piProviders) {
    merged.set(provider.provider, provider);
  }
  return [...merged.values()];
}

export function resolvePiModelSelection(
  snapshot: PiRuntimeSnapshot | null,
  selection: ModelSelection | null | undefined,
): { provider: string; modelId: string } | null {
  if (!snapshot) {
    return null;
  }

  const allModels = snapshot.models;
  const configuredModels = snapshot.models.filter((model) => model.authConfigured);
  const candidateModels = configuredModels.length > 0 ? configuredModels : allModels;
  if (candidateModels.length === 0) {
    return null;
  }

  if (!selection) {
    const fallback = candidateModels[0];
    return fallback ? { provider: fallback.provider, modelId: fallback.id } : null;
  }

  const requestedProvider = selection.provider;
  if (!isPiBackedProvider(requestedProvider)) {
    return null;
  }

  const exactMatch = candidateModels.find(
    (model) =>
      mapPiProviderToLegacyProvider(model.provider) === requestedProvider &&
      model.id === selection.model,
  );
  if (exactMatch) {
    return { provider: exactMatch.provider, modelId: exactMatch.id };
  }

  const sameProvider = candidateModels.find(
    (model) => mapPiProviderToLegacyProvider(model.provider) === requestedProvider,
  );
  if (sameProvider) {
    return { provider: sameProvider.provider, modelId: sameProvider.id };
  }

  const sameModelId = candidateModels.find((model) => model.id === selection.model);
  if (sameModelId) {
    return { provider: sameModelId.provider, modelId: sameModelId.id };
  }

  const fallback = candidateModels[0];
  return fallback ? { provider: fallback.provider, modelId: fallback.id } : null;
}

export function mapPiSnapshotToChatMessages(
  snapshot: PiThreadSnapshot | null,
): ReadonlyArray<ChatMessage> {
  if (!snapshot) {
    return [];
  }

  return snapshot.messages.map((message) => ({
    id: message.id as ChatMessage["id"],
    role: message.role === "user" ? "user" : message.role === "assistant" ? "assistant" : "system",
    text: message.text,
    createdAt: message.createdAt,
    streaming: message.pending,
    ...(message.pending ? {} : { completedAt: message.createdAt }),
  }));
}

export function mapPiSnapshotToThreadSession(
  snapshot: PiThreadSnapshot | null,
  fallbackProvider: ProviderKind,
): ThreadSession | null {
  if (!snapshot) {
    return null;
  }

  const provider = mapPiProviderToLegacyProvider(snapshot.provider) ?? fallbackProvider;
  const orchestrationStatus =
    snapshot.status === "running" ? "running" : snapshot.status === "error" ? "error" : "ready";

  return {
    provider,
    status:
      snapshot.status === "running" ? "running" : snapshot.status === "error" ? "error" : "ready",
    orchestrationStatus,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    ...(snapshot.lastError ? { lastError: snapshot.lastError } : {}),
  };
}
