/**
 * ProviderRegistryLive - Aggregates provider-specific snapshot services.
 *
 * @module ProviderRegistryLive
 */
import type { ProviderKind, ServerProvider } from "@t3tools/contracts";
import { Effect, Equal, Layer, PubSub, Ref, Stream } from "effect";

import { ClaudeProviderLive } from "./ClaudeProvider";
import { AmazonQProviderLive, KiroProviderLive } from "./CliAgentProvider";
import { CodexProviderLive } from "./CodexProvider";
import type { AmazonQProviderShape } from "../Services/AmazonQProvider";
import { AmazonQProvider } from "../Services/AmazonQProvider";
import type { ClaudeProviderShape } from "../Services/ClaudeProvider";
import { ClaudeProvider } from "../Services/ClaudeProvider";
import type { CodexProviderShape } from "../Services/CodexProvider";
import { CodexProvider } from "../Services/CodexProvider";
import type { KiroProviderShape } from "../Services/KiroProvider";
import { KiroProvider } from "../Services/KiroProvider";
import { ProviderRegistry, type ProviderRegistryShape } from "../Services/ProviderRegistry";

interface ProviderServices {
  readonly codexProvider: CodexProviderShape;
  readonly claudeProvider: ClaudeProviderShape;
  readonly kiroProvider: KiroProviderShape;
  readonly amazonQProvider: AmazonQProviderShape;
}

const loadProviders = (
  codexProvider: CodexProviderShape,
  claudeProvider: ClaudeProviderShape,
  kiroProvider: KiroProviderShape,
  amazonQProvider: AmazonQProviderShape,
): Effect.Effect<readonly [ServerProvider, ServerProvider, ServerProvider, ServerProvider]> =>
  Effect.all(
    [
      codexProvider.getSnapshot,
      claudeProvider.getSnapshot,
      kiroProvider.getSnapshot,
      amazonQProvider.getSnapshot,
    ],
    {
      concurrency: "unbounded",
    },
  );

export const haveProvidersChanged = (
  previousProviders: ReadonlyArray<ServerProvider>,
  nextProviders: ReadonlyArray<ServerProvider>,
): boolean => !Equal.equals(previousProviders, nextProviders);

const loadProviderServices = Effect.gen(function* () {
  const codexProvider = yield* CodexProvider;
  const claudeProvider = yield* ClaudeProvider;
  const kiroProvider = yield* KiroProvider;
  const amazonQProvider = yield* AmazonQProvider;
  return {
    codexProvider,
    claudeProvider,
    kiroProvider,
    amazonQProvider,
  } satisfies ProviderServices;
});

function loadProviderSnapshots(services: ProviderServices) {
  return loadProviders(
    services.codexProvider,
    services.claudeProvider,
    services.kiroProvider,
    services.amazonQProvider,
  );
}

function makeProviderSync(input: {
  readonly services: ProviderServices;
  readonly providersRef: Ref.Ref<ReadonlyArray<ServerProvider>>;
  readonly changesPubSub: PubSub.PubSub<ReadonlyArray<ServerProvider>>;
}) {
  return Effect.fn("syncProviders")(function* (options?: { readonly publish?: boolean }) {
    const previousProviders = yield* Ref.get(input.providersRef);
    const providers = yield* loadProviderSnapshots(input.services);
    yield* Ref.set(input.providersRef, providers);
    if (options?.publish !== false && haveProvidersChanged(previousProviders, providers)) {
      yield* PubSub.publish(input.changesPubSub, providers);
    }
    return providers;
  });
}

function forkProviderChangeStreams(
  services: ProviderServices,
  syncProviders: ReturnType<typeof makeProviderSync>,
) {
  const forkStream = (stream: Stream.Stream<unknown>) =>
    Stream.runForEach(stream, () => syncProviders()).pipe(Effect.forkScoped);
  return Effect.all(
    [
      forkStream(services.codexProvider.streamChanges),
      forkStream(services.claudeProvider.streamChanges),
      forkStream(services.kiroProvider.streamChanges),
      forkStream(services.amazonQProvider.streamChanges),
    ],
    { discard: true },
  );
}

const refreshProvider = Effect.fn("refreshProvider")(function* (
  services: ProviderServices,
  provider?: ProviderKind,
) {
  switch (provider) {
    case "codex":
      yield* services.codexProvider.refresh;
      break;
    case "claudeAgent":
      yield* services.claudeProvider.refresh;
      break;
    case "kiro":
      yield* services.kiroProvider.refresh;
      break;
    case "amazonQ":
      yield* services.amazonQProvider.refresh;
      break;
    default:
      yield* Effect.all(
        [
          services.codexProvider.refresh,
          services.claudeProvider.refresh,
          services.kiroProvider.refresh,
          services.amazonQProvider.refresh,
        ],
        { concurrency: "unbounded" },
      );
      break;
  }
});

const makeProviderRegistry = Effect.gen(function* () {
  const services = yield* loadProviderServices;
  const changesPubSub = yield* Effect.acquireRelease(
    PubSub.unbounded<ReadonlyArray<ServerProvider>>(),
    PubSub.shutdown,
  );
  const providersRef = yield* Ref.make<ReadonlyArray<ServerProvider>>(
    yield* loadProviderSnapshots(services),
  );
  const syncProviders = makeProviderSync({ services, providersRef, changesPubSub });
  yield* forkProviderChangeStreams(services, syncProviders);

  return {
    getProviders: syncProviders({ publish: false }).pipe(
      Effect.tapError(Effect.logError),
      Effect.orElseSucceed(() => []),
    ),
    refresh: (provider?: ProviderKind) =>
      refreshProvider(services, provider).pipe(
        Effect.flatMap(() => syncProviders()),
        Effect.tapError(Effect.logError),
        Effect.orElseSucceed(() => []),
      ),
    get streamChanges() {
      return Stream.fromPubSub(changesPubSub);
    },
  } satisfies ProviderRegistryShape;
});

export const ProviderRegistryLive = Layer.effect(ProviderRegistry, makeProviderRegistry).pipe(
  Layer.provideMerge(CodexProviderLive),
  Layer.provideMerge(ClaudeProviderLive),
  Layer.provideMerge(KiroProviderLive),
  Layer.provideMerge(AmazonQProviderLive),
);
