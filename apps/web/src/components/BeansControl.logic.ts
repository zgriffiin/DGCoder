import type { BeansBean } from "@t3tools/contracts";

interface BeanImplementationPromptInput {
  id: string;
  title: string;
  status: string;
  type: string;
  priority: string;
  body: string;
}

function normalizeMultilineText(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .trim()
    .replace(/\n{3,}/g, "\n\n");
}

export function extractBeanIntent(body: string): string | null {
  const normalizedBody = normalizeMultilineText(body);
  if (normalizedBody.length === 0) {
    return null;
  }

  const intentMatch = normalizedBody.match(
    /(?:^|\n)intent\s*:\s*([\s\S]*?)(?=\n[A-Z][A-Za-z0-9 _-]*:\s|\n#{1,6}\s|$)/i,
  );
  const intent = intentMatch?.[1] ? normalizeMultilineText(intentMatch[1]) : "";
  return intent.length > 0 ? intent : null;
}

export function buildBeanImplementationPrompt(input: BeanImplementationPromptInput): string {
  const normalizedBody = normalizeMultilineText(input.body);
  const intent = extractBeanIntent(normalizedBody);
  const description =
    normalizedBody.length > 0 ? normalizedBody : "No additional bean details recorded.";

  return [
    `Implement bean ${input.id}: "${input.title.trim()}".`,
    "",
    "Intent:",
    intent ??
      "No explicit Intent is recorded in this bean. Infer the likely intent from the details below, draft a stronger Intent statement, and ask me to confirm it before making major changes if anything is ambiguous.",
    "",
    "Bean metadata:",
    `- Type: ${input.type.trim() || "unspecified"}`,
    `- Priority: ${input.priority.trim() || "unspecified"}`,
    `- Status: ${input.status.trim() || "unspecified"}`,
    "",
    "Bean details:",
    description,
    "",
    "Implementation instructions:",
    "- Read the bean details carefully and identify the intended outcome.",
    "- If the Intent is missing or unclear, propose a stronger Intent statement and ask for confirmation before major implementation.",
    "- Produce a short implementation plan.",
    "- Implement the change in this repo.",
    "- Add or update functional validation that proves the intent when appropriate.",
    "- Summarize what changed and note any follow-up work or risks.",
  ].join("\n");
}

export function buildBeanImplementationPromptFromBean(
  bean: Pick<BeansBean, "id" | "title" | "status" | "type" | "priority" | "body">,
): string {
  return buildBeanImplementationPrompt({
    id: bean.id,
    title: bean.title,
    status: bean.status,
    type: bean.type,
    priority: bean.priority ?? "",
    body: bean.body ?? "",
  });
}

export function findParentBean(
  beans: ReadonlyArray<Pick<BeansBean, "id" | "title" | "type" | "parent">>,
  bean: Pick<BeansBean, "parent"> | null | undefined,
): Pick<BeansBean, "id" | "title" | "type" | "parent"> | null {
  if (!bean?.parent) {
    return null;
  }
  return beans.find((candidate) => candidate.id === bean.parent) ?? null;
}

export function findChildBeans(
  beans: ReadonlyArray<Pick<BeansBean, "id" | "title" | "status" | "parent" | "updated_at">>,
  parentId: string | null | undefined,
): Array<Pick<BeansBean, "id" | "title" | "status" | "parent" | "updated_at">> {
  if (!parentId) {
    return [];
  }

  return beans
    .filter((bean) => bean.parent === parentId)
    .toSorted(
      (left, right) =>
        right.updated_at.localeCompare(left.updated_at) || left.id.localeCompare(right.id),
    );
}
