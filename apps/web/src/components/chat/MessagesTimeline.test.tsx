import { MessageId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

let MessagesTimeline: typeof import("./MessagesTimeline").MessagesTimeline;

function matchMedia() {
  return {
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

beforeAll(() => {
  const classList = {
    add: () => {},
    remove: () => {},
    toggle: () => {},
    contains: () => false,
  };

  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  });
  vi.stubGlobal("window", {
    matchMedia,
    addEventListener: () => {},
    removeEventListener: () => {},
    desktopBridge: undefined,
  });
  vi.stubGlobal("document", {
    documentElement: {
      classList,
      offsetHeight: 0,
    },
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
});

beforeAll(async () => {
  ({ MessagesTimeline } = await import("./MessagesTimeline"));
}, 20_000);

const ACTIVE_THREAD_ENVIRONMENT_ID = "environment-local" as never;

describe("MessagesTimeline", () => {
  it("renders inline terminal labels with the composer chip UI", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages
        progressState={null}
        activeTurnInProgress={false}
        checkpointActionsDisabled={false}
        scrollContainer={null}
        timelineEntries={[
          {
            id: "entry-1",
            kind: "message",
            createdAt: "2026-03-17T19:12:28.000Z",
            message: {
              id: MessageId.makeUnsafe("message-2"),
              role: "user",
              text: [
                "yoo what's @terminal-1:1-5 mean",
                "",
                "<terminal_context>",
                "- Terminal 1 lines 1-5:",
                "  1 | julius@mac effect-http-ws-cli % bun i",
                "  2 | bun install v1.3.9 (cf6cdbbb)",
                "</terminal_context>",
              ].join("\n"),
              createdAt: "2026-03-17T19:12:28.000Z",
              streaming: false,
            },
          },
        ]}
        completionDividerBeforeEntryId={null}
        completionSummary={null}
        turnDiffSummaryByAssistantMessageId={new Map()}
        nowIso="2026-03-17T19:12:30.000Z"
        expandedWorkGroups={{}}
        onToggleWorkGroup={() => {}}
        onOpenTurnDiff={() => {}}
        revertTurnCountByUserMessageId={new Map()}
        onRevertUserMessage={() => {}}
        isRevertingCheckpoint={false}
        onImageExpand={() => {}}
        activeThreadEnvironmentId={ACTIVE_THREAD_ENVIRONMENT_ID}
        markdownCwd={undefined}
        resolvedTheme="light"
        timestampFormat="locale"
        workspaceRoot={undefined}
      />,
    );

    expect(markup).toContain("Terminal 1 lines 1-5");
    expect(markup).toContain("lucide-terminal");
    expect(markup).toContain("yoo what&#x27;s ");
  });

  it("renders context compaction entries in the normal work log", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages
        progressState={null}
        activeTurnInProgress={false}
        checkpointActionsDisabled={false}
        scrollContainer={null}
        timelineEntries={[
          {
            id: "entry-1",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "work-1",
              createdAt: "2026-03-17T19:12:28.000Z",
              label: "Context compacted",
              tone: "info",
            },
          },
        ]}
        completionDividerBeforeEntryId={null}
        completionSummary={null}
        turnDiffSummaryByAssistantMessageId={new Map()}
        nowIso="2026-03-17T19:12:30.000Z"
        expandedWorkGroups={{}}
        onToggleWorkGroup={() => {}}
        onOpenTurnDiff={() => {}}
        revertTurnCountByUserMessageId={new Map()}
        onRevertUserMessage={() => {}}
        isRevertingCheckpoint={false}
        onImageExpand={() => {}}
        activeThreadEnvironmentId={ACTIVE_THREAD_ENVIRONMENT_ID}
        markdownCwd={undefined}
        resolvedTheme="light"
        timestampFormat="locale"
        workspaceRoot={undefined}
      />,
    );

    expect(markup).toContain("Context compacted");
    expect(markup).toContain("Work log");
  });

  it("marks detailed work log entries as openable", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages
        progressState={null}
        activeTurnInProgress={false}
        checkpointActionsDisabled={false}
        scrollContainer={null}
        timelineEntries={[
          {
            id: "entry-quality-gate",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "work-quality-gate",
              createdAt: "2026-03-17T19:12:28.000Z",
              label: "Quality gate failed",
              tone: "error",
              detail: "Quality gate failed after agent file changes.\n- file.ts has 900 lines.",
            },
          },
        ]}
        completionDividerBeforeEntryId={null}
        completionSummary={null}
        turnDiffSummaryByAssistantMessageId={new Map()}
        nowIso="2026-03-17T19:12:30.000Z"
        expandedWorkGroups={{}}
        onToggleWorkGroup={() => {}}
        onOpenTurnDiff={() => {}}
        revertTurnCountByUserMessageId={new Map()}
        onRevertUserMessage={() => {}}
        isRevertingCheckpoint={false}
        onImageExpand={() => {}}
        activeThreadEnvironmentId={ACTIVE_THREAD_ENVIRONMENT_ID}
        markdownCwd={undefined}
        resolvedTheme="light"
        timestampFormat="locale"
        workspaceRoot={undefined}
      />,
    );

    expect(markup).toContain("Quality gate failed");
    expect(markup).toContain("Open full work log detail");
  });

  it("renders explicit post-run progress copy", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages
        progressState={{
          phase: "post_processing",
          label: "Post-run checks",
          statusMessage: "Agent finished. Running quality gate.",
          startedAt: "2026-03-17T19:12:28.000Z",
          showTimer: true,
        }}
        activeTurnInProgress
        checkpointActionsDisabled
        scrollContainer={null}
        timelineEntries={[]}
        completionDividerBeforeEntryId={null}
        completionSummary={null}
        turnDiffSummaryByAssistantMessageId={new Map()}
        nowIso="2026-03-17T19:12:30.000Z"
        expandedWorkGroups={{}}
        onToggleWorkGroup={() => {}}
        onOpenTurnDiff={() => {}}
        revertTurnCountByUserMessageId={new Map()}
        onRevertUserMessage={() => {}}
        isRevertingCheckpoint={false}
        onImageExpand={() => {}}
        activeThreadEnvironmentId={ACTIVE_THREAD_ENVIRONMENT_ID}
        markdownCwd={undefined}
        resolvedTheme="light"
        timestampFormat="locale"
        workspaceRoot={undefined}
      />,
    );

    expect(markup).toContain("Post-run checks");
    expect(markup).toContain("Agent finished. Running quality gate.");
  });

  it("renders waiting input without an active work timer", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        hasMessages
        progressState={{
          phase: "waiting_user_input",
          label: "Waiting for input",
          statusMessage: null,
          startedAt: "2026-03-17T19:12:28.000Z",
          showTimer: false,
        }}
        activeTurnInProgress
        checkpointActionsDisabled={false}
        scrollContainer={null}
        timelineEntries={[]}
        completionDividerBeforeEntryId={null}
        completionSummary={null}
        turnDiffSummaryByAssistantMessageId={new Map()}
        nowIso="2026-03-17T19:12:30.000Z"
        expandedWorkGroups={{}}
        onToggleWorkGroup={() => {}}
        onOpenTurnDiff={() => {}}
        revertTurnCountByUserMessageId={new Map()}
        onRevertUserMessage={() => {}}
        isRevertingCheckpoint={false}
        onImageExpand={() => {}}
        activeThreadEnvironmentId={ACTIVE_THREAD_ENVIRONMENT_ID}
        markdownCwd={undefined}
        resolvedTheme="light"
        timestampFormat="locale"
        workspaceRoot={undefined}
      />,
    );

    expect(markup).toContain("Waiting for input");
    expect(markup).not.toContain("Waiting for input for");
  });
});
