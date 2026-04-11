import type {
  BeansArchiveInput,
  BeansCreateInput,
  BeansInitInput,
  BeansListInput,
  BeansRoadmapInput,
  BeansUpdateInput,
  EnvironmentId,
} from "@t3tools/contracts";
import { queryOptions, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { ensureEnvironmentApi } from "~/environmentApi";

const BEANS_STALE_TIME_MS = 5_000;
const BEANS_REFETCH_INTERVAL_MS = 30_000;

export const beansQueryKeys = {
  all: ["beans"] as const,
  projectState: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["beans", "project-state", environmentId ?? null, cwd] as const,
  list: (
    environmentId: EnvironmentId | null,
    cwd: string | null,
    search: string,
    readyOnly: boolean,
  ) => ["beans", "list", environmentId ?? null, cwd, search, readyOnly] as const,
  roadmap: (environmentId: EnvironmentId | null, cwd: string | null) =>
    ["beans", "roadmap", environmentId ?? null, cwd] as const,
};

function isBeansScopeQueryKey(
  queryKey: QueryKey,
  input?: { environmentId?: EnvironmentId | null; cwd?: string | null },
): boolean {
  if (queryKey[0] !== "beans") {
    return false;
  }

  const environmentId = input?.environmentId ?? null;
  const cwd = input?.cwd ?? null;
  if (environmentId === null && cwd === null) {
    return true;
  }

  const scopedEnvironmentId = queryKey[2];
  const scopedCwd = queryKey[3];
  if (environmentId !== null && scopedEnvironmentId !== environmentId) {
    return false;
  }
  if (cwd !== null && scopedCwd !== cwd) {
    return false;
  }
  return true;
}

export function invalidateBeansQueries(
  queryClient: QueryClient,
  input?: { environmentId?: EnvironmentId | null; cwd?: string | null },
) {
  return queryClient.invalidateQueries({
    predicate: (query) => isBeansScopeQueryKey(query.queryKey, input),
  });
}

export function beansProjectStateQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  enabled?: boolean;
}) {
  return queryOptions({
    queryKey: beansQueryKeys.projectState(input.environmentId, input.cwd),
    queryFn: async () => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Beans project state is unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).beans.getProjectState({
        cwd: input.cwd,
      });
    },
    enabled: (input.enabled ?? true) && input.environmentId !== null && input.cwd !== null,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: input.enabled === false ? false : BEANS_REFETCH_INTERVAL_MS,
  });
}

export function beansListQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  search: string;
  readyOnly?: boolean;
  enabled?: boolean;
}) {
  return queryOptions({
    queryKey: beansQueryKeys.list(
      input.environmentId,
      input.cwd,
      input.search,
      input.readyOnly === true,
    ),
    queryFn: async () => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Beans are unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).beans.list({
        cwd: input.cwd,
        ...(input.search.length > 0 ? { search: input.search } : {}),
        ...(input.readyOnly ? { readyOnly: true } : {}),
        includeBody: true,
      } satisfies BeansListInput);
    },
    enabled: (input.enabled ?? true) && input.environmentId !== null && input.cwd !== null,
    staleTime: BEANS_STALE_TIME_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: input.enabled === false ? false : BEANS_REFETCH_INTERVAL_MS,
  });
}

export function beansRoadmapQueryOptions(input: {
  environmentId: EnvironmentId | null;
  cwd: string | null;
  enabled?: boolean;
}) {
  return queryOptions({
    queryKey: beansQueryKeys.roadmap(input.environmentId, input.cwd),
    queryFn: async () => {
      if (!input.environmentId || !input.cwd) {
        throw new Error("Beans roadmap is unavailable.");
      }
      return ensureEnvironmentApi(input.environmentId).beans.roadmap({
        cwd: input.cwd,
      } satisfies BeansRoadmapInput);
    },
    enabled: (input.enabled ?? true) && input.environmentId !== null && input.cwd !== null,
    staleTime: BEANS_STALE_TIME_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: input.enabled === false ? false : BEANS_REFETCH_INTERVAL_MS,
  });
}

export async function initBeans(environmentId: EnvironmentId, input: BeansInitInput) {
  return ensureEnvironmentApi(environmentId).beans.init(input);
}

export async function createBean(environmentId: EnvironmentId, input: BeansCreateInput) {
  return ensureEnvironmentApi(environmentId).beans.create(input);
}

export async function updateBean(environmentId: EnvironmentId, input: BeansUpdateInput) {
  return ensureEnvironmentApi(environmentId).beans.update(input);
}

export async function archiveBeans(environmentId: EnvironmentId, input: BeansArchiveInput) {
  return ensureEnvironmentApi(environmentId).beans.archive(input);
}
