import { randomUUID } from "node:crypto";

import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";
import {
  PiRuntimeError,
  type PiAbortThreadInput,
  type PiCreateThreadInput,
  type PiGetThreadInput,
  PiThreadId,
  type PiRuntimeSnapshot,
  type PiSendPromptInput,
  type PiSetThreadModelInput,
  type PiThreadSnapshot,
  type PiThreadSummary,
} from "@t3tools/contracts";
import { Effect, Layer, PubSub, Schema, Stream } from "effect";

import { ServerConfig } from "../../config.ts";
import {
  PiRuntime,
  type ActivePiThreadState,
  type PiRuntimeShape,
  type PiThreadListInfo,
} from "../Services/PiRuntime.ts";

function toPiError(detail: string, cause?: unknown): PiRuntimeError {
  const normalized = detail.trim();
  return new PiRuntimeError({
    detail: normalized.length > 0 ? normalized : "Pi runtime error",
    ...(cause !== undefined ? { cause } : {}),
  });
}

function toIsoDate(value: string | number | Date | undefined | null): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date().toISOString();
}

function trimToUndefined(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function titleFromPreview(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    return fallback;
  }

  const singleLine = normalized.replace(/\s+/g, " ").trim();
  return singleLine.length > 80 ? `${singleLine.slice(0, 77)}...` : singleLine;
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .flatMap((part) => {
      if (typeof part === "string") {
        return [part];
      }
      if (!part || typeof part !== "object") {
        return [];
      }
      const maybeText = (part as { text?: unknown }).text;
      return typeof maybeText === "string" ? [maybeText] : [];
    })
    .join("");
}

function messageName(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  return trimToUndefined(
    typeof record.toolName === "string"
      ? record.toolName
      : typeof record.customType === "string"
        ? record.customType
        : undefined,
  );
}

function mapThreadMessages(messages: ReadonlyArray<unknown>): PiThreadSnapshot["messages"] {
  const result: Array<PiThreadSnapshot["messages"][number]> = [];

  for (const [index, message] of messages.entries()) {
    if (!message || typeof message !== "object") {
      continue;
    }

    const record = message as Record<string, unknown>;
    const rawRole = typeof record.role === "string" ? record.role : "custom";
    const createdAt = toIsoDate(record.timestamp as string | number | undefined);
    const id = `msg-${index + 1}-${rawRole}`;

    switch (rawRole) {
      case "user":
        result.push({
          id,
          role: "user",
          text: extractTextContent(record.content),
          createdAt,
          pending: false,
        });
        break;
      case "assistant":
        result.push({
          id,
          role: "assistant",
          text: extractTextContent(record.content),
          createdAt,
          pending: false,
        });
        break;
      case "toolResult":
      case "bashExecution":
        result.push({
          id,
          role: "tool",
          text:
            rawRole === "bashExecution"
              ? [`$ ${(record.command as string | undefined) ?? ""}`, record.output]
                  .filter((value) => typeof value === "string" && value.trim().length > 0)
                  .join("\n\n")
              : extractTextContent(record.content),
          createdAt,
          pending: false,
          ...(messageName(record) ? { name: messageName(record) } : {}),
        });
        break;
      case "system":
        result.push({
          id,
          role: "system",
          text: extractTextContent(record.content),
          createdAt,
          pending: false,
        });
        break;
      case "branchSummary":
      case "compactionSummary":
        result.push({
          id,
          role: "system",
          text: typeof record.summary === "string" ? record.summary : "",
          createdAt,
          pending: false,
        });
        break;
      case "custom":
        result.push({
          id,
          role: "custom",
          text: extractTextContent(record.content),
          createdAt,
          pending: false,
          ...(messageName(record) ? { name: messageName(record) } : {}),
        });
        break;
      default:
        break;
    }
  }

  return result;
}

function snapshotToSummary(snapshot: PiThreadSnapshot): PiThreadSummary {
  const lastMessage = snapshot.messages
    .toReversed()
    .find((message) => message.text.trim().length > 0);

  return {
    id: snapshot.id,
    title: snapshot.title,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    status: snapshot.status,
    ...(lastMessage ? { preview: titleFromPreview(lastMessage.text, snapshot.title) } : {}),
    ...(snapshot.provider ? { provider: snapshot.provider } : {}),
    ...(snapshot.modelId ? { modelId: snapshot.modelId } : {}),
    ...(snapshot.lastError ? { lastError: snapshot.lastError } : {}),
  };
}

function makePendingAssistantMessage() {
  return {
    id: `pending-assistant-${randomUUID()}`,
    role: "assistant" as const,
    text: "",
    createdAt: new Date().toISOString(),
    pending: true,
  };
}

function ensurePendingAssistantMessage(snapshot: PiThreadSnapshot): PiThreadSnapshot {
  const lastMessage = snapshot.messages.at(-1);
  if (lastMessage?.role === "assistant" && lastMessage.pending) {
    return snapshot;
  }

  return {
    ...snapshot,
    messages: [...snapshot.messages, makePendingAssistantMessage()],
  };
}

function updatePendingAssistantText(snapshot: PiThreadSnapshot, delta: string): PiThreadSnapshot {
  const lastMessage = snapshot.messages.at(-1);
  if (!lastMessage || lastMessage.role !== "assistant" || !lastMessage.pending) {
    const nextSnapshot = ensurePendingAssistantMessage(snapshot);
    return updatePendingAssistantText(nextSnapshot, delta);
  }

  return {
    ...snapshot,
    messages: [
      ...snapshot.messages.slice(0, -1),
      {
        ...lastMessage,
        text: `${lastMessage.text}${delta}`,
      },
    ],
  };
}

function finalizePendingAssistant(snapshot: PiThreadSnapshot): PiThreadSnapshot {
  const lastMessage = snapshot.messages.at(-1);
  if (!lastMessage || lastMessage.role !== "assistant" || !lastMessage.pending) {
    return snapshot;
  }

  return {
    ...snapshot,
    messages: [
      ...snapshot.messages.slice(0, -1),
      {
        ...lastMessage,
        pending: false,
      },
    ],
  };
}

function modelIdentity(model: unknown): { provider?: string; modelId?: string } {
  if (!model || typeof model !== "object") {
    return {};
  }

  const record = model as Record<string, unknown>;
  const provider = trimToUndefined(
    typeof record.provider === "string" ? record.provider : undefined,
  );
  const modelId = trimToUndefined(typeof record.id === "string" ? record.id : undefined);

  return {
    ...(provider ? { provider } : {}),
    ...(modelId ? { modelId } : {}),
  };
}

function threadTitle(input: {
  requestedTitle: string | undefined;
  sessionName: string | undefined;
  firstMessage: string | undefined;
  fallback: string;
}): string {
  return titleFromPreview(
    input.requestedTitle ?? input.sessionName ?? input.firstMessage,
    input.fallback,
  );
}

export const PiRuntimeLive = Layer.effect(
  PiRuntime,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const services = yield* Effect.services<never>();
    const authFilePath = `${config.piAgentDir}/auth.json`;
    const authStorage = AuthStorage.create(`${config.piAgentDir}/auth.json`);
    const modelRegistry = ModelRegistry.create(authStorage, `${config.piAgentDir}/models.json`);
    const threadEvents = yield* PubSub.unbounded<{
      version: 1;
      type: "threadSnapshot";
      snapshot: PiThreadSnapshot;
    }>();
    const activeThreads = new Map<PiThreadId, ActivePiThreadState>();
    const sessionPathById = new Map<PiThreadId, string>();

    const publishSnapshot = (snapshot: PiThreadSnapshot) => {
      const event: { version: 1; type: "threadSnapshot"; snapshot: PiThreadSnapshot } = {
        version: 1,
        type: "threadSnapshot",
        snapshot,
      };
      return PubSub.publish(threadEvents, event).pipe(Effect.runPromiseWith(services));
    };

    const buildRuntimeSnapshot = (): PiRuntimeSnapshot => {
      const models = modelRegistry.getAll().flatMap((model) => {
        const provider = trimToUndefined(model.provider);
        const id = trimToUndefined(model.id);
        const name = trimToUndefined(model.name) ?? id;

        if (!provider || !id || !name) {
          return [];
        }

        return [
          {
            provider,
            id,
            name,
            reasoning: model.reasoning,
            input: [...model.input],
            contextWindow: model.contextWindow,
            maxTokens: model.maxTokens,
            authConfigured: modelRegistry.hasConfiguredAuth(model),
          },
        ];
      });

      const providerCounts = new Map<
        string,
        {
          totalModels: number;
          availableModels: number;
        }
      >();

      for (const model of models) {
        const counts = providerCounts.get(model.provider) ?? {
          totalModels: 0,
          availableModels: 0,
        };
        counts.totalModels += 1;
        if (model.authConfigured) {
          counts.availableModels += 1;
        }
        providerCounts.set(model.provider, counts);
      }

      const configuredModelCount = models.filter((model) => model.authConfigured).length;

      return {
        providers: [...providerCounts.entries()]
          .map(([provider, counts]) => ({
            provider,
            totalModels: counts.totalModels,
            availableModels: counts.availableModels,
          }))
          .toSorted((left, right) => left.provider.localeCompare(right.provider)),
        models: models.toSorted(
          (left, right) =>
            left.provider.localeCompare(right.provider) || left.name.localeCompare(right.name),
        ),
        configuredModelCount,
        authFilePath,
        ...(trimToUndefined(modelRegistry.getError())
          ? { loadError: trimToUndefined(modelRegistry.getError()) }
          : {}),
      };
    };

    const noConfiguredModelsMessage = () =>
      [
        "No configured models are available.",
        `Add credentials in ${authFilePath}`,
        "or launch the app with a supported provider key like OPENAI_API_KEY or ANTHROPIC_API_KEY,",
        "then reload models.",
      ].join(" ");

    const providerAuthRequiredMessage = (provider: string) =>
      [
        `Authentication is not configured for ${provider}.`,
        `Add credentials in ${authFilePath}`,
        "or launch the app with the matching provider environment variables,",
        "then reload models.",
      ].join(" ");

    const resolveModel = (provider?: string, modelId?: string) => {
      const normalizedProvider = trimToUndefined(provider);
      const normalizedModelId = trimToUndefined(modelId);
      if (!normalizedProvider || !normalizedModelId) {
        return undefined;
      }

      return modelRegistry.find(normalizedProvider, normalizedModelId);
    };

    const resolveDefaultModel = () => {
      const available = modelRegistry.getAvailable();
      return available.length > 0 ? available[0] : undefined;
    };

    const toThreadSnapshot = (
      state: ActivePiThreadState,
      overrides?: Partial<PiThreadSnapshot>,
    ): PiThreadSnapshot => {
      const messages = mapThreadMessages(state.session.state.messages);
      const model = modelIdentity(state.session.model);
      const sessionFile = trimToUndefined(state.session.sessionFile);
      const snapshot: PiThreadSnapshot = {
        id: state.threadId,
        title: threadTitle({
          requestedTitle: undefined,
          sessionName: trimToUndefined(state.session.sessionName),
          firstMessage: messages.find((message) => message.role === "user")?.text,
          fallback: "Untitled Pi session",
        }),
        cwd: config.cwd,
        sessionId: state.session.sessionId,
        ...(sessionFile ? { sessionFile } : {}),
        createdAt: state.snapshot.createdAt,
        updatedAt: new Date().toISOString(),
        status: state.snapshot.status,
        ...(model.provider ? { provider: model.provider } : {}),
        ...(model.modelId ? { modelId: model.modelId } : {}),
        ...(state.snapshot.pendingToolName
          ? { pendingToolName: state.snapshot.pendingToolName }
          : {}),
        ...(state.snapshot.lastError ? { lastError: state.snapshot.lastError } : {}),
        messages,
      };

      return {
        ...snapshot,
        ...overrides,
      };
    };

    const applySnapshot = (state: ActivePiThreadState, snapshot: PiThreadSnapshot) => {
      state.snapshot = snapshot;
      if (snapshot.sessionFile) {
        sessionPathById.set(state.threadId, snapshot.sessionFile);
      }
      return publishSnapshot(snapshot);
    };

    const attachSessionListeners = (state: ActivePiThreadState) => {
      state.unsubscribe?.();
      state.unsubscribe = state.session.subscribe((event) => {
        const updatedAt = new Date().toISOString();

        switch (event.type) {
          case "agent_start": {
            void applySnapshot(
              state,
              ensurePendingAssistantMessage({
                ...state.snapshot,
                status: "running",
                updatedAt,
                pendingToolName: undefined,
                lastError: undefined,
              }),
            );
            break;
          }
          case "message_update": {
            if (event.assistantMessageEvent.type !== "text_delta") {
              break;
            }
            void applySnapshot(
              state,
              updatePendingAssistantText(
                {
                  ...state.snapshot,
                  status: "running",
                  updatedAt,
                },
                event.assistantMessageEvent.delta,
              ),
            );
            break;
          }
          case "tool_execution_start": {
            void applySnapshot(state, {
              ...state.snapshot,
              status: "running",
              updatedAt,
              pendingToolName: titleFromPreview(event.toolName, event.toolName),
            });
            break;
          }
          case "tool_execution_end": {
            void applySnapshot(state, {
              ...state.snapshot,
              updatedAt,
              pendingToolName: undefined,
            });
            break;
          }
          case "agent_end": {
            void applySnapshot(
              state,
              finalizePendingAssistant(
                toThreadSnapshot(state, {
                  status: state.snapshot.lastError ? "error" : "idle",
                  updatedAt,
                  pendingToolName: undefined,
                }),
              ),
            );
            break;
          }
          default:
            break;
        }
      });
    };

    const createSessionState = async (
      sessionManager: SessionManager,
      options?: {
        title: string | undefined;
        provider: string | undefined;
        modelId: string | undefined;
      },
    ) => {
      const requestedModel = resolveModel(options?.provider, options?.modelId);
      if (requestedModel && !modelRegistry.hasConfiguredAuth(requestedModel)) {
        throw toPiError(providerAuthRequiredMessage(requestedModel.provider));
      }

      const model = requestedModel ?? resolveDefaultModel();
      const { session } = await createAgentSession({
        cwd: config.cwd,
        agentDir: config.piAgentDir,
        authStorage,
        modelRegistry,
        sessionManager,
        settingsManager: SettingsManager.inMemory(),
        ...(model ? { model } : {}),
      });

      if (options?.title && options.title.trim().length > 0) {
        session.setSessionName(options.title);
      }

      const threadId = PiThreadId.makeUnsafe(session.sessionId);
      const state: ActivePiThreadState = {
        threadId,
        sessionPath: trimToUndefined(session.sessionFile),
        session,
        snapshot: {
          id: threadId,
          title: threadTitle({
            requestedTitle: options?.title,
            sessionName: trimToUndefined(session.sessionName),
            firstMessage: undefined,
            fallback: "Untitled Pi session",
          }),
          cwd: config.cwd,
          sessionId: session.sessionId,
          ...(trimToUndefined(session.sessionFile)
            ? { sessionFile: trimToUndefined(session.sessionFile) }
            : {}),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          status: "idle",
          messages: [],
        },
        inFlightPrompt: null,
        unsubscribe: null,
      };

      state.snapshot = toThreadSnapshot(state);
      attachSessionListeners(state);
      activeThreads.set(threadId, state);
      if (state.snapshot.sessionFile) {
        sessionPathById.set(threadId, state.snapshot.sessionFile);
      }
      return state;
    };

    const listSessionInfos = async (): Promise<ReadonlyArray<PiThreadListInfo>> => {
      const infos = await SessionManager.list(config.cwd, config.piSessionsDir);
      return infos.map((info) => ({
        path: info.path,
        id: info.id,
        name: trimToUndefined(info.name),
        created: info.created,
        modified: info.modified,
        firstMessage: info.firstMessage,
      }));
    };

    const findSessionPath = async (threadId: PiThreadId): Promise<string | undefined> => {
      const existing = sessionPathById.get(threadId);
      if (existing) {
        return existing;
      }

      const sessions = await listSessionInfos();
      const match = sessions.find((session) => session.id === threadId);
      if (match) {
        sessionPathById.set(threadId, match.path);
        return match.path;
      }

      return undefined;
    };

    const ensureThreadState = async (
      input: PiGetThreadInput | PiAbortThreadInput | PiSendPromptInput | PiSetThreadModelInput,
    ): Promise<ActivePiThreadState> => {
      const active = activeThreads.get(input.threadId);
      if (active) {
        return active;
      }

      const sessionPath = await findSessionPath(input.threadId);
      if (!sessionPath) {
        throw toPiError(`Pi session ${input.threadId} was not found.`);
      }

      const state = await createSessionState(
        SessionManager.open(sessionPath, config.piSessionsDir, config.cwd),
      );
      state.snapshot = toThreadSnapshot(state, {
        createdAt: toIsoDate(state.snapshot.createdAt),
        updatedAt: new Date().toISOString(),
      });
      return state;
    };

    const runtime = {
      getRuntimeSnapshot: Effect.try({
        try: buildRuntimeSnapshot,
        catch: (cause) => toPiError("Failed to load Pi model catalog.", cause),
      }),
      refreshRuntimeSnapshot: Effect.try({
        try: () => {
          modelRegistry.refresh();
          return buildRuntimeSnapshot();
        },
        catch: (cause) => toPiError("Failed to refresh Pi model catalog.", cause),
      }),
      listThreads: Effect.tryPromise({
        try: async () => {
          const sessions = await listSessionInfos();
          return sessions
            .map((session) => {
              const threadId = PiThreadId.makeUnsafe(session.id);
              const active = activeThreads.get(threadId);
              if (active) {
                return snapshotToSummary(active.snapshot);
              }

              sessionPathById.set(threadId, session.path);
              const summary = {
                id: threadId,
                title: threadTitle({
                  requestedTitle: session.name,
                  sessionName: undefined,
                  firstMessage: session.firstMessage,
                  fallback: "Untitled Pi session",
                }),
                createdAt: session.created.toISOString(),
                updatedAt: session.modified.toISOString(),
                status: "idle" as const,
              } satisfies Omit<PiThreadSummary, "preview">;
              const preview = trimToUndefined(session.firstMessage);
              return preview
                ? Object.assign({}, summary, {
                    preview: titleFromPreview(preview, "Untitled Pi session"),
                  })
                : summary;
            })
            .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
        },
        catch: (cause) => toPiError("Failed to list Pi sessions.", cause),
      }),
      getThread: (input: PiGetThreadInput) =>
        Effect.tryPromise({
          try: async () => {
            const state = await ensureThreadState(input);
            state.snapshot = toThreadSnapshot(state);
            return state.snapshot;
          },
          catch: (cause) => toPiError("Failed to open Pi session.", cause),
        }),
      createThread: (input: PiCreateThreadInput) =>
        Effect.tryPromise({
          try: async () => {
            const state = await createSessionState(
              SessionManager.create(config.cwd, config.piSessionsDir),
              {
                title: trimToUndefined(input.title),
                provider: trimToUndefined(input.provider),
                modelId: trimToUndefined(input.modelId),
              },
            );
            await publishSnapshot(state.snapshot);
            return state.snapshot;
          },
          catch: (cause) => toPiError("Failed to create Pi session.", cause),
        }),
      sendPrompt: (input: PiSendPromptInput) =>
        Effect.tryPromise({
          try: async () => {
            const state = await ensureThreadState(input);
            if (state.inFlightPrompt || state.session.isStreaming) {
              throw toPiError("This Pi session is already running.");
            }

            const selectedModel = resolveModel(input.provider, input.modelId);
            if (input.provider || input.modelId) {
              if (!selectedModel) {
                throw toPiError("The selected Pi model is unavailable.");
              }
              if (!modelRegistry.hasConfiguredAuth(selectedModel)) {
                throw toPiError(providerAuthRequiredMessage(selectedModel.provider));
              }
              await state.session.setModel(selectedModel);
            }

            const activeModel = selectedModel ?? state.session.model;
            if (!activeModel) {
              throw toPiError(noConfiguredModelsMessage());
            }
            if (!modelRegistry.hasConfiguredAuth(activeModel)) {
              throw toPiError(providerAuthRequiredMessage(activeModel.provider));
            }

            const now = new Date().toISOString();
            state.snapshot = {
              ...toThreadSnapshot(state, {
                status: "running",
                updatedAt: now,
                pendingToolName: undefined,
                lastError: undefined,
              }),
              messages: [
                ...toThreadSnapshot(state).messages,
                {
                  id: `user-${randomUUID()}`,
                  role: "user",
                  text: input.prompt,
                  createdAt: now,
                  pending: false,
                },
              ],
            };
            state.snapshot = ensurePendingAssistantMessage(state.snapshot);
            await publishSnapshot(state.snapshot);

            state.inFlightPrompt = state.session
              .prompt(input.prompt)
              .then(async () => {
                state.snapshot = finalizePendingAssistant(
                  toThreadSnapshot(state, {
                    status: "idle",
                    updatedAt: new Date().toISOString(),
                    pendingToolName: undefined,
                    lastError: undefined,
                  }),
                );
                await publishSnapshot(state.snapshot);
              })
              .catch(async (error: unknown) => {
                state.snapshot = finalizePendingAssistant(
                  toThreadSnapshot(state, {
                    status: "error",
                    updatedAt: new Date().toISOString(),
                    pendingToolName: undefined,
                    lastError:
                      error instanceof Error && error.message.trim().length > 0
                        ? error.message
                        : "Pi prompt failed.",
                  }),
                );
                await publishSnapshot(state.snapshot);
              })
              .finally(() => {
                state.inFlightPrompt = null;
              });

            return state.snapshot;
          },
          catch: (cause) =>
            Schema.is(PiRuntimeError)(cause)
              ? cause
              : toPiError("Failed to send Pi prompt.", cause),
        }),
      setThreadModel: (input: PiSetThreadModelInput) =>
        Effect.tryPromise({
          try: async () => {
            const state = await ensureThreadState(input);
            if (state.inFlightPrompt || state.session.isStreaming) {
              throw toPiError("Wait for the current Pi turn to finish before switching models.");
            }

            const model = resolveModel(input.provider, input.modelId);
            if (!model) {
              throw toPiError("The selected Pi model is unavailable.");
            }
            if (!modelRegistry.hasConfiguredAuth(model)) {
              throw toPiError(providerAuthRequiredMessage(model.provider));
            }

            await state.session.setModel(model);
            state.snapshot = toThreadSnapshot(state, {
              updatedAt: new Date().toISOString(),
              lastError: undefined,
            });
            await publishSnapshot(state.snapshot);
            return state.snapshot;
          },
          catch: (cause) =>
            Schema.is(PiRuntimeError)(cause)
              ? cause
              : toPiError("Failed to update the Pi model.", cause),
        }),
      abortThread: (input: PiAbortThreadInput) =>
        Effect.tryPromise({
          try: async () => {
            const state = await ensureThreadState(input);
            await state.session.abort();
            state.snapshot = finalizePendingAssistant(
              toThreadSnapshot(state, {
                status: "idle",
                updatedAt: new Date().toISOString(),
                pendingToolName: undefined,
              }),
            );
            await publishSnapshot(state.snapshot);
            return state.snapshot;
          },
          catch: (cause) => toPiError("Failed to abort the Pi session.", cause),
        }),
      get streamEvents() {
        return Stream.fromPubSub(threadEvents);
      },
    } satisfies PiRuntimeShape;

    return runtime;
  }),
);
