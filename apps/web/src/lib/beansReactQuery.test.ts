import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("../environmentApi", () => ({
  ensureEnvironmentApi: vi.fn(),
}));

import { EnvironmentId } from "@t3tools/contracts";

import {
  beansListQueryOptions,
  beansProjectStateQueryOptions,
  beansRoadmapQueryOptions,
  invalidateBeansQueries,
} from "./beansReactQuery";

const ENVIRONMENT_A = EnvironmentId.makeUnsafe("environment-a");
const ENVIRONMENT_B = EnvironmentId.makeUnsafe("environment-b");

describe("invalidateBeansQueries", () => {
  it("can invalidate a single workspace scope without blasting other beans queries", async () => {
    const queryClient = new QueryClient();

    queryClient.setQueryData(
      beansListQueryOptions({
        environmentId: ENVIRONMENT_A,
        cwd: "/repo/a",
        search: "",
      }).queryKey,
      { beans: [] },
    );
    queryClient.setQueryData(
      beansProjectStateQueryOptions({
        environmentId: ENVIRONMENT_A,
        cwd: "/repo/a",
      }).queryKey,
      {
        installed: true,
        initialized: true,
        configPath: "/repo/a/.beans.yml",
        beansPath: "/repo/a/.beans",
      },
    );
    queryClient.setQueryData(
      beansRoadmapQueryOptions({
        environmentId: ENVIRONMENT_B,
        cwd: "/repo/b",
      }).queryKey,
      { markdown: "# Roadmap" },
    );

    await invalidateBeansQueries(queryClient, {
      environmentId: ENVIRONMENT_A,
      cwd: "/repo/a",
    });

    expect(
      queryClient.getQueryState(
        beansListQueryOptions({
          environmentId: ENVIRONMENT_A,
          cwd: "/repo/a",
          search: "",
        }).queryKey,
      )?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(
        beansProjectStateQueryOptions({
          environmentId: ENVIRONMENT_A,
          cwd: "/repo/a",
        }).queryKey,
      )?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(
        beansRoadmapQueryOptions({
          environmentId: ENVIRONMENT_B,
          cwd: "/repo/b",
        }).queryKey,
      )?.isInvalidated,
    ).toBe(false);
  });
});
