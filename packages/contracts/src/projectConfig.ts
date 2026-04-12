import { Schema } from "effect";

import { PositiveInt, TrimmedNonEmptyString } from "./baseSchemas";
import { GitStackedAction } from "./git";

export const DEFAULT_LOCAL_REVIEW_ENFORCE_ON = [
  "commit_push",
  "commit_push_pr",
  "create_pr",
] as const satisfies ReadonlyArray<"commit_push" | "commit_push_pr" | "create_pr">;
export const DEFAULT_LOCAL_REVIEW_TIMEOUT_MS = 300_000;

export const LocalReviewTool = Schema.Literal("coderabbit");
export type LocalReviewTool = typeof LocalReviewTool.Type;

export const LocalReviewEnforceAction = GitStackedAction;
export type LocalReviewEnforceAction = typeof LocalReviewEnforceAction.Type;

export const LocalReviewConfig = Schema.Struct({
  tool: LocalReviewTool,
  command: TrimmedNonEmptyString,
  args: Schema.Array(Schema.String),
  enforceOn: Schema.Array(LocalReviewEnforceAction).pipe(
    Schema.withDecodingDefault(() => [...DEFAULT_LOCAL_REVIEW_ENFORCE_ON]),
  ),
  timeoutMs: PositiveInt.pipe(Schema.withDecodingDefault(() => DEFAULT_LOCAL_REVIEW_TIMEOUT_MS)),
});
export type LocalReviewConfig = typeof LocalReviewConfig.Type;

export const T3CodeProjectConfig = Schema.Struct({
  version: Schema.Literal(1),
  localReview: Schema.optional(LocalReviewConfig),
});
export type T3CodeProjectConfig = typeof T3CodeProjectConfig.Type;
