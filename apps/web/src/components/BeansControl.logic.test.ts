import { describe, expect, it } from "vitest";

import {
  buildBeanImplementationPrompt,
  buildBeanImplementationPromptFromBean,
  extractBeanIntent,
  findChildBeans,
  findParentBean,
} from "./BeansControl.logic";

describe("extractBeanIntent", () => {
  it("reads a single-line intent statement", () => {
    expect(
      extractBeanIntent("Intent: Make reviews mandatory before merge.\n\nAcceptance: Done."),
    ).toBe("Make reviews mandatory before merge.");
  });

  it("reads a multiline intent block", () => {
    expect(
      extractBeanIntent(
        "Context\n\nIntent:\nCreate a safer implementation workflow.\nKeep the UI predictable.\n\nNotes:\nDo not regress draft handling.",
      ),
    ).toBe("Create a safer implementation workflow.\nKeep the UI predictable.");
  });

  it("returns null when intent is missing", () => {
    expect(extractBeanIntent("Body without the expected label.")).toBeNull();
  });
});

describe("buildBeanImplementationPrompt", () => {
  it("includes bean metadata and details", () => {
    const prompt = buildBeanImplementationPrompt({
      id: "DGCoder-1234",
      title: "Add review gate",
      status: "todo",
      type: "feature",
      priority: "high",
      body: "Intent: Protect merges with required review.\n\nRequire at least one local review path.",
    });

    expect(prompt).toContain('Implement bean DGCoder-1234: "Add review gate".');
    expect(prompt).toContain("Intent:\nProtect merges with required review.");
    expect(prompt).toContain("- Type: feature");
    expect(prompt).toContain("- Priority: high");
    expect(prompt).toContain("- Status: todo");
    expect(prompt).toContain("Require at least one local review path.");
  });

  it("falls back when no explicit intent is recorded", () => {
    const prompt = buildBeanImplementationPrompt({
      id: "DGCoder-5678",
      title: "Tighten validation",
      status: "todo",
      type: "task",
      priority: "",
      body: "",
    });

    expect(prompt).toContain("No explicit Intent is recorded in this bean.");
    expect(prompt).toContain("No additional bean details recorded.");
  });
});

describe("buildBeanImplementationPromptFromBean", () => {
  it("maps bean fields into the implementation prompt", () => {
    const prompt = buildBeanImplementationPromptFromBean({
      id: "DGCoder-abcd",
      title: "Implement button",
      status: "in-progress",
      type: "feature",
      priority: "normal",
      body: "Intent: Launch focused implementation threads from Beans.",
    });

    expect(prompt).toContain("DGCoder-abcd");
    expect(prompt).toContain("Launch focused implementation threads from Beans.");
  });
});

describe("bean hierarchy helpers", () => {
  const beans = [
    {
      id: "EPIC-1",
      title: "Epic",
      status: "todo",
      type: "epic",
      parent: undefined,
      updated_at: "2026-04-09T18:29:59Z",
    },
    {
      id: "TASK-1",
      title: "Task 1",
      status: "in-progress",
      type: "task",
      parent: "EPIC-1",
      updated_at: "2026-04-09T18:30:01Z",
    },
    {
      id: "TASK-2",
      title: "Task 2",
      status: "todo",
      type: "task",
      parent: "EPIC-1",
      updated_at: "2026-04-09T18:30:00Z",
    },
  ] as const;

  it("finds a parent bean by id", () => {
    expect(findParentBean(beans, beans[1])).toEqual(beans[0]);
  });

  it("returns null when no parent is set", () => {
    expect(findParentBean(beans, beans[0])).toBeNull();
  });

  it("returns child beans sorted by recency", () => {
    expect(findChildBeans(beans, "EPIC-1").map((bean) => bean.id)).toEqual(["TASK-1", "TASK-2"]);
  });
});
