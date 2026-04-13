import { Schema } from "effect";

import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  TrimmedNonEmptyString,
  TrimmedString,
} from "./baseSchemas";

export const PiThreadId = TrimmedNonEmptyString.pipe(Schema.brand("PiThreadId"));
export type PiThreadId = typeof PiThreadId.Type;

export const PiThreadStatus = Schema.Literals(["idle", "running", "error"]);
export type PiThreadStatus = typeof PiThreadStatus.Type;

export const PiMessageRole = Schema.Literals(["user", "assistant", "tool", "system", "custom"]);
export type PiMessageRole = typeof PiMessageRole.Type;

export const PiModelInputKind = Schema.Literals(["text", "image"]);
export type PiModelInputKind = typeof PiModelInputKind.Type;

export const PiModelDescriptor = Schema.Struct({
  provider: TrimmedNonEmptyString,
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  reasoning: Schema.Boolean,
  input: Schema.Array(PiModelInputKind),
  contextWindow: PositiveInt,
  maxTokens: PositiveInt,
  authConfigured: Schema.Boolean,
});
export type PiModelDescriptor = typeof PiModelDescriptor.Type;

export const PiProviderDescriptor = Schema.Struct({
  provider: TrimmedNonEmptyString,
  totalModels: NonNegativeInt,
  availableModels: NonNegativeInt,
});
export type PiProviderDescriptor = typeof PiProviderDescriptor.Type;

export const PiRuntimeSnapshot = Schema.Struct({
  providers: Schema.Array(PiProviderDescriptor),
  models: Schema.Array(PiModelDescriptor),
  configuredModelCount: NonNegativeInt,
  authFilePath: TrimmedNonEmptyString,
  loadError: Schema.optional(TrimmedNonEmptyString),
});
export type PiRuntimeSnapshot = typeof PiRuntimeSnapshot.Type;

export const PiThreadSummary = Schema.Struct({
  id: PiThreadId,
  title: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  status: PiThreadStatus,
  preview: Schema.optional(TrimmedString),
  provider: Schema.optional(TrimmedNonEmptyString),
  modelId: Schema.optional(TrimmedNonEmptyString),
  lastError: Schema.optional(TrimmedNonEmptyString),
});
export type PiThreadSummary = typeof PiThreadSummary.Type;

export const PiThreadMessage = Schema.Struct({
  id: TrimmedNonEmptyString,
  role: PiMessageRole,
  text: Schema.String,
  createdAt: IsoDateTime,
  pending: Schema.Boolean,
  name: Schema.optional(TrimmedNonEmptyString),
});
export type PiThreadMessage = typeof PiThreadMessage.Type;

export const PiThreadSnapshot = Schema.Struct({
  id: PiThreadId,
  title: TrimmedNonEmptyString,
  cwd: TrimmedNonEmptyString,
  sessionId: TrimmedNonEmptyString,
  sessionFile: Schema.optional(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  status: PiThreadStatus,
  provider: Schema.optional(TrimmedNonEmptyString),
  modelId: Schema.optional(TrimmedNonEmptyString),
  pendingToolName: Schema.optional(TrimmedNonEmptyString),
  lastError: Schema.optional(TrimmedNonEmptyString),
  messages: Schema.Array(PiThreadMessage),
});
export type PiThreadSnapshot = typeof PiThreadSnapshot.Type;

export const PiGetThreadInput = Schema.Struct({
  threadId: PiThreadId,
});
export type PiGetThreadInput = typeof PiGetThreadInput.Type;

export const PiCreateThreadInput = Schema.Struct({
  title: Schema.optional(TrimmedString),
  provider: Schema.optional(TrimmedNonEmptyString),
  modelId: Schema.optional(TrimmedNonEmptyString),
});
export type PiCreateThreadInput = typeof PiCreateThreadInput.Type;

export const PiSendPromptInput = Schema.Struct({
  threadId: PiThreadId,
  prompt: TrimmedNonEmptyString,
  provider: Schema.optional(TrimmedNonEmptyString),
  modelId: Schema.optional(TrimmedNonEmptyString),
});
export type PiSendPromptInput = typeof PiSendPromptInput.Type;

export const PiSetThreadModelInput = Schema.Struct({
  threadId: PiThreadId,
  provider: TrimmedNonEmptyString,
  modelId: TrimmedNonEmptyString,
});
export type PiSetThreadModelInput = typeof PiSetThreadModelInput.Type;

export const PiAbortThreadInput = Schema.Struct({
  threadId: PiThreadId,
});
export type PiAbortThreadInput = typeof PiAbortThreadInput.Type;

export const PiThreadStreamSnapshotEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("threadSnapshot"),
  snapshot: PiThreadSnapshot,
});
export type PiThreadStreamSnapshotEvent = typeof PiThreadStreamSnapshotEvent.Type;

export const PiThreadStreamEvent = Schema.Union([PiThreadStreamSnapshotEvent]);
export type PiThreadStreamEvent = typeof PiThreadStreamEvent.Type;

export class PiRuntimeError extends Schema.TaggedErrorClass<PiRuntimeError>()("PiRuntimeError", {
  detail: TrimmedNonEmptyString,
  cause: Schema.optional(Schema.Defect),
}) {
  override get message(): string {
    return this.detail;
  }
}
