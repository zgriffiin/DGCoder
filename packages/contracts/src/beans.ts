import { Schema } from "effect";
import { TrimmedNonEmptyString } from "./baseSchemas";

const BeansOptionalText = Schema.optional(TrimmedNonEmptyString);

export const BeansProjectStateInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type BeansProjectStateInput = typeof BeansProjectStateInput.Type;

export const BeansProjectState = Schema.Struct({
  installed: Schema.Boolean,
  initialized: Schema.Boolean,
  cliVersion: Schema.optional(TrimmedNonEmptyString),
  configPath: TrimmedNonEmptyString,
  beansPath: TrimmedNonEmptyString,
});
export type BeansProjectState = typeof BeansProjectState.Type;

export const BeansBean = Schema.Struct({
  id: TrimmedNonEmptyString,
  slug: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  status: TrimmedNonEmptyString,
  type: TrimmedNonEmptyString,
  priority: BeansOptionalText,
  parent: BeansOptionalText,
  body: Schema.optional(Schema.String),
  created_at: TrimmedNonEmptyString,
  updated_at: TrimmedNonEmptyString,
  etag: TrimmedNonEmptyString,
});
export type BeansBean = typeof BeansBean.Type;

export const BeansListInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  search: BeansOptionalText,
  readyOnly: Schema.optional(Schema.Boolean),
  includeBody: Schema.optional(Schema.Boolean),
});
export type BeansListInput = typeof BeansListInput.Type;

export const BeansListResult = Schema.Struct({
  beans: Schema.Array(BeansBean),
});
export type BeansListResult = typeof BeansListResult.Type;

export const BeansInitInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type BeansInitInput = typeof BeansInitInput.Type;

export const BeansInitResult = Schema.Struct({
  state: BeansProjectState,
  message: TrimmedNonEmptyString,
});
export type BeansInitResult = typeof BeansInitResult.Type;

export const BeansCreateInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  status: BeansOptionalText,
  type: BeansOptionalText,
  priority: BeansOptionalText,
  parent: BeansOptionalText,
  body: Schema.optional(Schema.String),
});
export type BeansCreateInput = typeof BeansCreateInput.Type;

export const BeansCreateResult = Schema.Struct({
  bean: BeansBean,
  message: TrimmedNonEmptyString,
});
export type BeansCreateResult = typeof BeansCreateResult.Type;

export const BeansUpdateInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  id: TrimmedNonEmptyString,
  title: BeansOptionalText,
  status: BeansOptionalText,
  type: BeansOptionalText,
  priority: BeansOptionalText,
  body: Schema.optional(Schema.String),
});
export type BeansUpdateInput = typeof BeansUpdateInput.Type;

export const BeansUpdateResult = Schema.Struct({
  bean: BeansBean,
  message: TrimmedNonEmptyString,
});
export type BeansUpdateResult = typeof BeansUpdateResult.Type;

export const BeansArchiveInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type BeansArchiveInput = typeof BeansArchiveInput.Type;

export const BeansArchiveResult = Schema.Struct({
  message: TrimmedNonEmptyString,
});
export type BeansArchiveResult = typeof BeansArchiveResult.Type;

export const BeansRoadmapInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type BeansRoadmapInput = typeof BeansRoadmapInput.Type;

export const BeansRoadmapResult = Schema.Struct({
  markdown: Schema.String,
});
export type BeansRoadmapResult = typeof BeansRoadmapResult.Type;

export class BeansCommandError extends Schema.TaggedErrorClass<BeansCommandError>()(
  "BeansCommandError",
  {
    operation: TrimmedNonEmptyString,
    detail: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}
