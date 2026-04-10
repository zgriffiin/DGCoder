import type { ProviderRuntimeEvent, ThreadId } from "@t3tools/contracts";
import { Effect, Layer, Queue } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter";
import { AmazonQAdapter, type AmazonQAdapterShape } from "../Services/AmazonQAdapter";
import { KiroAdapter, type KiroAdapterShape } from "../Services/KiroAdapter";
import { ServerSettingsService } from "../../serverSettings";
import {
  CliAgentAdapterRuntime,
  type CliAgentAdapterConfig,
  type CliAgentSessionContext,
} from "./CliAgentAdapterRuntime";

function makeCliAgentAdapter(config: CliAgentAdapterConfig) {
  return Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const runtimeEventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>();
    const sessions = new Map<ThreadId, CliAgentSessionContext>();
    const runtime = new CliAgentAdapterRuntime(config, {
      serverSettings,
      spawner,
      runtimeEventQueue,
      sessions,
    });
    yield* Effect.addFinalizer(() => runtime.shutdown());
    return runtime.toAdapter();
  });
}

const KIRO_ADAPTER_CONFIG: CliAgentAdapterConfig = {
  provider: "kiro",
  displayName: "Kiro",
  selectCommandSettings: (settings) => settings.providers.kiro,
  buildTurnArgs: ({ prompt }) => ["chat", "--no-interactive", "--trust-all-tools", prompt],
};

const AMAZON_Q_ADAPTER_CONFIG: CliAgentAdapterConfig = {
  provider: "amazonQ",
  displayName: "Amazon Q",
  selectCommandSettings: (settings) => settings.providers.amazonQ,
  buildTurnArgs: ({ prompt }) => ["chat", "--no-interactive", "--trust-all-tools", prompt],
};

export const KiroAdapterLive = Layer.effect(
  KiroAdapter,
  makeCliAgentAdapter(KIRO_ADAPTER_CONFIG).pipe(
    Effect.map((adapter) => adapter as KiroAdapterShape),
  ),
);

export const AmazonQAdapterLive = Layer.effect(
  AmazonQAdapter,
  makeCliAgentAdapter(AMAZON_Q_ADAPTER_CONFIG).pipe(
    Effect.map((adapter) => adapter as AmazonQAdapterShape),
  ),
);

export type CliAgentAdapterShape = ProviderAdapterShape<ProviderAdapterError>;
