import type { BeansBean, EnvironmentId, ProjectId } from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRightIcon,
  GitBranchPlusIcon,
  HammerIcon,
  ListChecksIcon,
  LoaderCircleIcon,
  RefreshCcwIcon,
  SparklesIcon,
} from "lucide-react";
import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  archiveBeans,
  beansListQueryOptions,
  beansProjectStateQueryOptions,
  beansQueryKeys,
  beansRoadmapQueryOptions,
  createBean,
  initBeans,
  updateBean,
} from "~/lib/beansReactQuery";
import { cn } from "~/lib/utils";
import { useComposerDraftStore } from "../composerDraftStore";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  buildBeanImplementationPrompt,
  findChildBeans,
  findParentBean,
} from "./BeansControl.logic";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";
import { Textarea } from "./ui/textarea";

type BeansPaneMode = "detail" | "create" | "roadmap";

interface BeanFormState {
  title: string;
  status: string;
  type: string;
  priority: string;
  body: string;
}

const EMPTY_FORM: BeanFormState = {
  title: "",
  status: "todo",
  type: "task",
  priority: "normal",
  body: "",
};

const NONE_OPTION_VALUE = "__none__";

const STATUS_OPTIONS = [
  { value: "todo", label: "Todo" },
  { value: "in-progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "blocked", label: "Blocked" },
  { value: "scrapped", label: "Scrapped" },
] as const;

const TYPE_OPTIONS = [
  { value: "epic", label: "Epic" },
  { value: "feature", label: "Feature" },
  { value: "task", label: "Task" },
  { value: "bug", label: "Bug" },
  { value: "milestone", label: "Milestone" },
] as const;

const PRIORITY_OPTIONS = [
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low" },
  { value: "deferred", label: "Deferred" },
] as const;

function formFromBean(bean: BeansBean | null | undefined): BeanFormState {
  if (!bean) return EMPTY_FORM;
  return {
    title: bean.title,
    status: bean.status,
    type: bean.type,
    priority: bean.priority ?? "",
    body: bean.body?.replace(/^\n+/, "") ?? "",
  };
}

function beanSummary(body: string | undefined): string {
  const trimmed = body?.trim() ?? "";
  if (trimmed.length === 0) return "No description yet.";
  return trimmed.length > 140 ? `${trimmed.slice(0, 137)}...` : trimmed;
}

function statusTone(status: string): string {
  const normalized = status.trim().toLowerCase();
  if (normalized === "completed") return "border-emerald-500/30 bg-emerald-500/8 text-emerald-700";
  if (normalized === "in-progress")
    return "border-blue-500/30 bg-blue-500/8 text-blue-700 dark:text-blue-300";
  if (normalized === "scrapped")
    return "border-rose-500/30 bg-rose-500/8 text-rose-700 dark:text-rose-300";
  return "border-border bg-background text-foreground/80";
}

function formatBeanOptionLabel(value: string): string {
  return value
    .trim()
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function resolveBeanOptions(
  options: ReadonlyArray<{ value: string; label: string }>,
  currentValue: string,
) {
  const normalizedValue = currentValue.trim();
  if (normalizedValue.length === 0 || options.some((option) => option.value === normalizedValue)) {
    return options;
  }
  return [
    ...options,
    {
      value: normalizedValue,
      label: `${formatBeanOptionLabel(normalizedValue)} (custom)`,
    },
  ];
}

function BeanField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

function BeanSelectField({
  label,
  value,
  onChange,
  options,
  emptyLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  emptyLabel?: string;
}) {
  const resolvedOptions = resolveBeanOptions(options, value);
  const selectValue = value.trim().length === 0 && emptyLabel ? NONE_OPTION_VALUE : value;

  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      <Select
        value={selectValue}
        onValueChange={(nextValue) =>
          onChange(nextValue === NONE_OPTION_VALUE ? "" : (nextValue ?? ""))
        }
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          {emptyLabel ? <SelectItem value={NONE_OPTION_VALUE}>{emptyLabel}</SelectItem> : null}
          {resolvedOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </label>
  );
}

export default function BeansControl({
  environmentId,
  projectId,
  cwd,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  cwd: string | null;
}) {
  const queryClient = useQueryClient();
  const { handleNewThread } = useHandleNewThread();
  const [open, setOpen] = useState(false);
  const [paneMode, setPaneMode] = useState<BeansPaneMode>("detail");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [selectedBeanId, setSelectedBeanId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<BeanFormState>(EMPTY_FORM);
  const [createForm, setCreateForm] = useState<BeanFormState>(EMPTY_FORM);
  const [createParentBeanId, setCreateParentBeanId] = useState<string | null>(null);
  const [isImplementing, setIsImplementing] = useState(false);
  const [implementError, setImplementError] = useState<string | null>(null);

  const projectStateQuery = useQuery(
    beansProjectStateQueryOptions({
      environmentId,
      cwd,
      enabled: open && cwd !== null,
    }),
  );
  const initialized = projectStateQuery.data?.initialized === true;

  const listQuery = useQuery(
    beansListQueryOptions({
      environmentId,
      cwd,
      search: deferredSearch,
      enabled: open && initialized,
    }),
  );
  const roadmapQuery = useQuery(
    beansRoadmapQueryOptions({
      environmentId,
      cwd,
      enabled: open && initialized && paneMode === "roadmap",
    }),
  );

  const beans = useMemo(() => listQuery.data?.beans ?? [], [listQuery.data?.beans]);
  const beanById = useMemo(() => new Map(beans.map((bean) => [bean.id, bean])), [beans]);
  const childCountByParentId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const bean of beans) {
      if (!bean.parent) continue;
      counts.set(bean.parent, (counts.get(bean.parent) ?? 0) + 1);
    }
    return counts;
  }, [beans]);
  const selectedBean = useMemo(
    () => beans.find((bean) => bean.id === selectedBeanId) ?? null,
    [beans, selectedBeanId],
  );
  const selectedBeanParent = useMemo(
    () => findParentBean(beans, selectedBean),
    [beans, selectedBean],
  );
  const selectedBeanChildren = useMemo(
    () => findChildBeans(beans, selectedBean?.id),
    [beans, selectedBean?.id],
  );
  const createParentBean = useMemo(
    () =>
      createParentBeanId ? (beans.find((bean) => bean.id === createParentBeanId) ?? null) : null,
    [beans, createParentBeanId],
  );

  useEffect(() => {
    if (!open || paneMode !== "detail") return;
    if (!selectedBeanId && beans.length > 0) {
      setSelectedBeanId(beans[0]?.id ?? null);
    }
  }, [beans, open, paneMode, selectedBeanId]);

  useEffect(() => {
    if (paneMode !== "detail") return;
    setEditForm(formFromBean(selectedBean));
  }, [paneMode, selectedBean]);

  const invalidateBeans = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: beansQueryKeys.projectState(environmentId, cwd),
      }),
      queryClient.invalidateQueries({
        queryKey: beansQueryKeys.list(environmentId, cwd, deferredSearch, false),
      }),
      queryClient.invalidateQueries({
        queryKey: beansQueryKeys.roadmap(environmentId, cwd),
      }),
    ]);

  const initMutation = useMutation({
    mutationFn: async () => {
      if (!cwd) throw new Error("Beans are unavailable until this thread has an active project.");
      return initBeans(environmentId, { cwd });
    },
    onSuccess: async () => {
      await invalidateBeans();
      startTransition(() => {
        setPaneMode("detail");
      });
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!cwd) throw new Error("Beans are unavailable until this thread has an active project.");
      const title = createForm.title.trim();
      if (title.length === 0) {
        throw new Error("A bean title is required.");
      }
      return createBean(environmentId, {
        cwd,
        title,
        status: createForm.status.trim() || undefined,
        type: createForm.type.trim() || undefined,
        priority: createForm.priority.trim() || undefined,
        parent: createParentBeanId ?? undefined,
        body: createForm.body,
      });
    },
    onSuccess: async (result) => {
      await invalidateBeans();
      startTransition(() => {
        setSelectedBeanId(result.bean.id);
        setPaneMode("detail");
        setCreateForm(EMPTY_FORM);
        setCreateParentBeanId(null);
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!cwd) throw new Error("Beans are unavailable until this thread has an active project.");
      if (!selectedBean) throw new Error("Select a bean to update.");
      const title = editForm.title.trim();
      if (title.length === 0) {
        throw new Error("A bean title is required.");
      }
      return updateBean(environmentId, {
        cwd,
        id: selectedBean.id,
        title,
        status: editForm.status.trim() || undefined,
        type: editForm.type.trim() || undefined,
        priority: editForm.priority.trim(),
        body: editForm.body,
      });
    },
    onSuccess: async (result) => {
      await invalidateBeans();
      startTransition(() => {
        setSelectedBeanId(result.bean.id);
      });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async () => {
      if (!cwd) throw new Error("Beans are unavailable until this thread has an active project.");
      return archiveBeans(environmentId, { cwd });
    },
    onSuccess: async () => {
      await invalidateBeans();
    },
  });

  const actionError =
    (implementError ? new Error(implementError) : null) ??
    initMutation.error ??
    createMutation.error ??
    updateMutation.error ??
    archiveMutation.error ??
    projectStateQuery.error ??
    listQuery.error ??
    roadmapQuery.error;

  const actionErrorMessage =
    actionError instanceof Error ? actionError.message : "Beans action failed.";

  const handleCreateFieldChange = (field: keyof BeanFormState) => (value: string) => {
    setCreateForm((current) => ({ ...current, [field]: value }));
  };

  const handleEditFieldChange = (field: keyof BeanFormState) => (value: string) => {
    setEditForm((current) => ({ ...current, [field]: value }));
  };

  const isBusy =
    initMutation.isPending ||
    createMutation.isPending ||
    updateMutation.isPending ||
    archiveMutation.isPending ||
    isImplementing;

  const selectedBeanImplementationPrompt = selectedBean
    ? buildBeanImplementationPrompt({
        id: selectedBean.id,
        title: editForm.title,
        status: editForm.status,
        type: editForm.type,
        priority: editForm.priority,
        body: editForm.body,
      })
    : null;

  const handleImplementBean = async () => {
    if (!selectedBean || !selectedBeanImplementationPrompt) {
      return;
    }

    const projectRef = scopeProjectRef(environmentId, projectId);
    setIsImplementing(true);
    setImplementError(null);
    try {
      await handleNewThread(projectRef);
      const draftSession = useComposerDraftStore.getState().getDraftSessionByProjectRef(projectRef);
      if (!draftSession) {
        throw new Error("Could not open a draft thread for this bean.");
      }
      useComposerDraftStore
        .getState()
        .setPrompt(draftSession.draftId, selectedBeanImplementationPrompt);
      setOpen(false);
    } catch (error) {
      setImplementError(error instanceof Error ? error.message : "Failed to open bean draft.");
    } finally {
      setIsImplementing(false);
    }
  };

  const openCreateBeanPane = () => {
    setCreateParentBeanId(null);
    setCreateForm(EMPTY_FORM);
    setPaneMode("create");
  };

  const openCreateChildPane = () => {
    if (!selectedBean) {
      return;
    }

    setCreateParentBeanId(selectedBean.id);
    setCreateForm({
      ...EMPTY_FORM,
      type: selectedBean.type === "epic" || selectedBean.type === "milestone" ? "task" : "task",
    });
    setPaneMode("create");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        size="xs"
        variant="outline"
        disabled={!cwd}
        onClick={() => setOpen(true)}
        aria-label="Open Beans manager"
      >
        <ListChecksIcon className="size-3.5" />
        <span className="hidden @3xl/header-actions:inline">Beans</span>
      </Button>
      <DialogPopup className="h-[min(90vh,56rem)] max-w-6xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>Beans</DialogTitle>
          <DialogDescription>
            Manage project work tracked in `.beans/` without dropping back to the CLI.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex min-h-0 flex-1 flex-col pt-0">
          {!cwd ? (
            <div className="rounded-xl border border-border/70 bg-muted/30 p-4 text-sm text-muted-foreground">
              Beans is unavailable until this thread has an active project.
            </div>
          ) : projectStateQuery.isLoading ? (
            <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-muted/30 p-4 text-sm text-muted-foreground">
              <LoaderCircleIcon className="size-4 animate-spin" />
              Loading Beans project state...
            </div>
          ) : projectStateQuery.data?.installed === false ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/8 p-4 text-sm text-amber-800 dark:text-amber-200">
              The `beans` CLI is not available on PATH for this environment.
            </div>
          ) : !initialized ? (
            <div className="rounded-2xl border border-border/70 bg-muted/20 p-5">
              <div className="max-w-2xl space-y-2">
                <h3 className="font-medium text-foreground">Initialize Beans in this project</h3>
                <p className="text-sm text-muted-foreground">
                  Beans stores issues as Markdown files in this repository. Initializing here gives
                  the new UI a real project to manage and test against.
                </p>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button disabled={isBusy} onClick={() => initMutation.mutate()}>
                  {initMutation.isPending ? (
                    <LoaderCircleIcon className="size-4 animate-spin" />
                  ) : (
                    <SparklesIcon className="size-4" />
                  )}
                  Initialize Beans
                </Button>
                <p className="text-xs text-muted-foreground">
                  This creates `.beans.yml` and the `.beans/` workspace in the current project.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
              <section className="flex min-h-0 flex-col overflow-y-auto overscroll-contain rounded-2xl border border-border/70 bg-muted/12">
                <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border/70 bg-muted/95 p-3 backdrop-blur">
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search beans"
                    className="min-w-52 flex-1 bg-background"
                  />
                  <Button
                    size="xs"
                    variant={paneMode === "create" ? "default" : "outline"}
                    onClick={openCreateBeanPane}
                  >
                    New Bean
                  </Button>
                  <Button
                    size="xs"
                    variant={paneMode === "roadmap" ? "default" : "outline"}
                    onClick={() => setPaneMode("roadmap")}
                  >
                    Roadmap
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="outline"
                    aria-label="Refresh beans"
                    onClick={() => void invalidateBeans()}
                  >
                    <RefreshCcwIcon
                      className={cn("size-3.5", listQuery.isFetching && "animate-spin")}
                    />
                  </Button>
                </div>
                <div className="space-y-2 p-3">
                  {listQuery.isLoading ? (
                    <div className="rounded-xl border border-border/70 bg-background/70 p-4 text-sm text-muted-foreground">
                      Loading beans...
                    </div>
                  ) : beans.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border/70 bg-background/60 p-5 text-sm text-muted-foreground">
                      No beans match this view yet. Create one to start tracking work here.
                    </div>
                  ) : (
                    beans.map((bean) => {
                      const active = bean.id === selectedBeanId && paneMode === "detail";
                      const parentBean = bean.parent ? (beanById.get(bean.parent) ?? null) : null;
                      const childCount = childCountByParentId.get(bean.id) ?? 0;
                      return (
                        <button
                          key={bean.id}
                          type="button"
                          className={cn(
                            "group w-full rounded-xl border px-4 py-3 text-left transition-colors",
                            active
                              ? "border-primary/40 bg-primary/6"
                              : "border-border/70 bg-background/70 hover:border-border hover:bg-background",
                          )}
                          onClick={() => {
                            setSelectedBeanId(bean.id);
                            setPaneMode("detail");
                          }}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="truncate font-medium text-foreground">
                                  {bean.title}
                                </span>
                                <ChevronRightIcon
                                  className={cn(
                                    "size-3.5 shrink-0 text-muted-foreground transition-transform",
                                    active && "translate-x-0.5 text-foreground",
                                  )}
                                />
                              </div>
                              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                                {beanSummary(bean.body)}
                              </p>
                              {parentBean ? (
                                <p className="mt-2 text-[11px] text-muted-foreground">
                                  Child of{" "}
                                  <span className="font-medium text-foreground/80">
                                    {parentBean.title}
                                  </span>
                                </p>
                              ) : null}
                            </div>
                            <div className="flex shrink-0 flex-col items-end gap-1">
                              <Badge
                                variant="outline"
                                className={cn("capitalize", statusTone(bean.status))}
                              >
                                {bean.status}
                              </Badge>
                              <span className="font-mono text-[10px] text-muted-foreground">
                                {bean.id}
                              </span>
                            </div>
                          </div>
                          <div className="mt-3 flex flex-wrap items-center gap-1.5">
                            <Badge variant="outline" className="capitalize">
                              {bean.type}
                            </Badge>
                            {bean.priority ? (
                              <Badge variant="outline" className="capitalize text-muted-foreground">
                                {bean.priority}
                              </Badge>
                            ) : null}
                            {childCount > 0 ? (
                              <Badge variant="outline" className="text-muted-foreground">
                                {childCount} {childCount === 1 ? "child" : "children"}
                              </Badge>
                            ) : null}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </section>

              <section className="flex min-h-0 flex-col overflow-y-auto overscroll-contain rounded-2xl border border-border/70 bg-background/80">
                {paneMode === "roadmap" ? (
                  <>
                    <div className="sticky top-0 z-10 border-b border-border/70 bg-background/95 px-4 py-3 backdrop-blur">
                      <h3 className="font-medium text-foreground">Roadmap</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Live output from `beans roadmap` for the current project.
                      </p>
                    </div>
                    <div className="p-4">
                      {roadmapQuery.isLoading ? (
                        <div className="text-sm text-muted-foreground">Building roadmap...</div>
                      ) : (
                        <pre className="whitespace-pre-wrap rounded-xl border border-border/70 bg-muted/18 p-4 font-mono text-xs leading-6 text-foreground">
                          {roadmapQuery.data?.markdown.trim() || "No roadmap output yet."}
                        </pre>
                      )}
                    </div>
                  </>
                ) : paneMode === "create" ? (
                  <>
                    <div className="sticky top-0 z-10 border-b border-border/70 bg-background/95 px-4 py-3 backdrop-blur">
                      <h3 className="font-medium text-foreground">
                        {createParentBean ? "Create child bean" : "Create bean"}
                      </h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {createParentBean
                          ? "This creates a child bean with the parent relationship already set."
                          : "This writes a new Markdown-backed Bean into `.beans/`."}
                      </p>
                    </div>
                    <div className="space-y-4 p-4">
                      {createParentBean ? (
                        <div className="rounded-xl border border-border/70 bg-muted/18 px-3 py-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                                Creating under parent {createParentBean.type}
                              </div>
                              <div className="mt-1 truncate text-sm font-medium text-foreground">
                                {createParentBean.title}
                              </div>
                              <div className="font-mono text-[10px] text-muted-foreground">
                                {createParentBean.id}
                              </div>
                            </div>
                            <Badge variant="outline" className="capitalize">
                              {createParentBean.type}
                            </Badge>
                            <Button
                              size="xs"
                              variant="outline"
                              onClick={() => setCreateParentBeanId(null)}
                            >
                              Clear parent
                            </Button>
                          </div>
                        </div>
                      ) : null}
                      <BeanField
                        label="Title"
                        value={createForm.title}
                        onChange={handleCreateFieldChange("title")}
                        placeholder="Short summary"
                      />
                      <div className="grid gap-3 sm:grid-cols-3">
                        <BeanSelectField
                          label="Status"
                          value={createForm.status}
                          onChange={handleCreateFieldChange("status")}
                          options={STATUS_OPTIONS}
                        />
                        <BeanSelectField
                          label="Type"
                          value={createForm.type}
                          onChange={handleCreateFieldChange("type")}
                          options={TYPE_OPTIONS}
                        />
                        <BeanSelectField
                          label="Priority"
                          value={createForm.priority}
                          onChange={handleCreateFieldChange("priority")}
                          options={PRIORITY_OPTIONS}
                          emptyLabel="No priority"
                        />
                      </div>
                      <label className="flex min-w-0 flex-col gap-1.5">
                        <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                          Description
                        </span>
                        <Textarea
                          value={createForm.body}
                          onChange={(event) => handleCreateFieldChange("body")(event.target.value)}
                          rows={10}
                          placeholder="Describe the work, acceptance criteria, or notes."
                        />
                      </label>
                    </div>
                  </>
                ) : selectedBean ? (
                  <>
                    <div className="sticky top-0 z-10 border-b border-border/70 bg-background/95 px-4 py-3 backdrop-blur">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="truncate font-medium text-foreground">
                            {selectedBean.title}
                          </h3>
                          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                            {selectedBean.id}
                          </p>
                          {selectedBeanParent ? (
                            <div className="mt-3 rounded-xl border border-primary/20 bg-primary/5 px-3 py-3">
                              <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                                Child of {selectedBeanParent.type}
                              </div>
                              <button
                                type="button"
                                className="mt-2 flex w-full items-center justify-between gap-3 rounded-lg border border-border/70 bg-background px-3 py-2 text-left transition-colors hover:border-border hover:bg-background/90"
                                onClick={() => {
                                  setSelectedBeanId(selectedBeanParent.id);
                                  setPaneMode("detail");
                                }}
                              >
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-medium text-foreground">
                                    {selectedBeanParent.title}
                                  </div>
                                  <div className="font-mono text-[10px] text-muted-foreground">
                                    {selectedBeanParent.id}
                                  </div>
                                </div>
                                <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
                              </button>
                            </div>
                          ) : selectedBeanChildren.length > 0 ? (
                            <div className="mt-3 rounded-xl border border-border/70 bg-muted/18 px-3 py-3">
                              <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                                Parent bean
                              </div>
                              <p className="mt-1 text-xs text-muted-foreground">
                                This bean currently groups {selectedBeanChildren.length} child{" "}
                                {selectedBeanChildren.length === 1 ? "bean" : "beans"}.
                              </p>
                            </div>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                          <Badge
                            variant="outline"
                            className={cn("capitalize", statusTone(selectedBean.status))}
                          >
                            {selectedBean.status}
                          </Badge>
                          <Badge variant="outline" className="capitalize">
                            {selectedBean.type}
                          </Badge>
                          {selectedBean.priority ? (
                            <Badge variant="outline" className="capitalize text-muted-foreground">
                              {selectedBean.priority}
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <div className="space-y-4 p-4">
                      <BeanField
                        label="Title"
                        value={editForm.title}
                        onChange={handleEditFieldChange("title")}
                      />
                      <div className="grid gap-3 sm:grid-cols-3">
                        <BeanSelectField
                          label="Status"
                          value={editForm.status}
                          onChange={handleEditFieldChange("status")}
                          options={STATUS_OPTIONS}
                        />
                        <BeanSelectField
                          label="Type"
                          value={editForm.type}
                          onChange={handleEditFieldChange("type")}
                          options={TYPE_OPTIONS}
                        />
                        <BeanSelectField
                          label="Priority"
                          value={editForm.priority}
                          onChange={handleEditFieldChange("priority")}
                          options={PRIORITY_OPTIONS}
                          emptyLabel="No priority"
                        />
                      </div>
                      <label className="flex min-w-0 flex-col gap-1.5">
                        <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                          Description
                        </span>
                        <Textarea
                          value={editForm.body}
                          onChange={(event) => handleEditFieldChange("body")(event.target.value)}
                          rows={12}
                        />
                      </label>
                      {selectedBeanParent || selectedBeanChildren.length > 0 ? (
                        <div className="rounded-xl border border-border/70 bg-muted/18 px-3 py-3">
                          <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                            Hierarchy
                          </div>
                          <div className="mt-2 space-y-3">
                            {selectedBeanParent ? (
                              <div className="space-y-1">
                                <div className="text-xs text-muted-foreground">
                                  Parent {selectedBeanParent.type}
                                </div>
                                <button
                                  type="button"
                                  className="flex w-full items-center justify-between rounded-lg border border-border/70 bg-background px-3 py-2 text-left transition-colors hover:border-border hover:bg-background/90"
                                  onClick={() => {
                                    setSelectedBeanId(selectedBeanParent.id);
                                    setPaneMode("detail");
                                  }}
                                >
                                  <div className="min-w-0">
                                    <div className="truncate text-sm font-medium text-foreground">
                                      {selectedBeanParent.title}
                                    </div>
                                    <div className="font-mono text-[10px] text-muted-foreground">
                                      {selectedBeanParent.id}
                                    </div>
                                  </div>
                                  <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
                                </button>
                              </div>
                            ) : null}
                            {selectedBeanChildren.length > 0 ? (
                              <div className="space-y-1">
                                <div className="text-xs text-muted-foreground">
                                  Children ({selectedBeanChildren.length})
                                </div>
                                <div className="space-y-2">
                                  {selectedBeanChildren.map((childBean) => (
                                    <button
                                      key={childBean.id}
                                      type="button"
                                      className="flex w-full items-center justify-between rounded-lg border border-border/70 bg-background px-3 py-2 text-left transition-colors hover:border-border hover:bg-background/90"
                                      onClick={() => {
                                        setSelectedBeanId(childBean.id);
                                        setPaneMode("detail");
                                      }}
                                    >
                                      <div className="min-w-0">
                                        <div className="truncate text-sm font-medium text-foreground">
                                          {childBean.title}
                                        </div>
                                        <div className="font-mono text-[10px] text-muted-foreground">
                                          {childBean.id}
                                        </div>
                                      </div>
                                      <div className="ml-3 flex shrink-0 items-center gap-2">
                                        <Badge
                                          variant="outline"
                                          className={cn("capitalize", statusTone(childBean.status))}
                                        >
                                          {childBean.status}
                                        </Badge>
                                        <ChevronRightIcon className="size-3.5 text-muted-foreground" />
                                      </div>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                      <div className="rounded-xl border border-border/70 bg-muted/18 px-3 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="max-w-md space-y-1">
                            <div className="text-sm font-medium text-foreground">
                              Break this work into child beans
                            </div>
                            <p className="text-xs leading-5 text-muted-foreground">
                              Create a new child bean from this detail view with the parent
                              relationship already attached, so implementation tasks stay grouped
                              under this bean.
                            </p>
                          </div>
                          <Button variant="outline" disabled={isBusy} onClick={openCreateChildPane}>
                            <GitBranchPlusIcon className="size-4" />
                            Create Child
                          </Button>
                        </div>
                      </div>
                      <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="max-w-md space-y-1">
                            <div className="text-sm font-medium text-foreground">
                              Start implementation from this bean
                            </div>
                            <p className="text-xs leading-5 text-muted-foreground">
                              Opens a focused draft thread in the main chat and prefills the
                              composer with this bean&apos;s current details and Intent so the agent
                              can begin from a structured implementation prompt.
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            disabled={isBusy || !selectedBeanImplementationPrompt}
                            onClick={() => void handleImplementBean()}
                          >
                            {isImplementing ? (
                              <LoaderCircleIcon className="size-4 animate-spin" />
                            ) : (
                              <HammerIcon className="size-4" />
                            )}
                            Implement
                          </Button>
                        </div>
                      </div>
                      <div className="rounded-xl border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                        Updated {new Date(selectedBean.updated_at).toLocaleString()}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex min-h-[22rem] items-center justify-center p-6 text-center text-sm text-muted-foreground">
                    Select a bean to edit it, or create a new one.
                  </div>
                )}
              </section>
            </div>
          )}

          {actionError ? (
            <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/6 px-4 py-3 text-sm text-destructive">
              {actionErrorMessage}
            </div>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          {initialized ? (
            <>
              <Button
                variant="outline"
                disabled={isBusy || !cwd}
                onClick={() => archiveMutation.mutate()}
              >
                Archive completed
              </Button>
              {paneMode === "create" ? (
                <Button
                  disabled={isBusy || createForm.title.trim().length === 0}
                  onClick={() => createMutation.mutate()}
                >
                  {createMutation.isPending ? (
                    <LoaderCircleIcon className="size-4 animate-spin" />
                  ) : null}
                  Create bean
                </Button>
              ) : paneMode === "detail" ? (
                <Button
                  disabled={isBusy || !selectedBean || editForm.title.trim().length === 0}
                  onClick={() => updateMutation.mutate()}
                >
                  {updateMutation.isPending ? (
                    <LoaderCircleIcon className="size-4 animate-spin" />
                  ) : null}
                  Save changes
                </Button>
              ) : (
                <Button variant="outline" onClick={() => void invalidateBeans()}>
                  Refresh roadmap
                </Button>
              )}
            </>
          ) : null}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
