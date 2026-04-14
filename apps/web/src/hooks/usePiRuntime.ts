import { type EnvironmentId, type PiRuntimeSnapshot } from "@t3tools/contracts";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { readEnvironmentApi } from "../environmentApi";
import { useWsConnectionStatus } from "../rpc/wsConnectionState";
import { getWsRpcClient, subscribeWsRpcClientRegistry } from "../wsRpcClient";

type PiRuntimeRequestMode = "get" | "refresh";

function readPiApi(environmentId?: EnvironmentId | null) {
  if (environmentId) {
    const environmentApi = readEnvironmentApi(environmentId);
    if (environmentApi) {
      return environmentApi.pi;
    }
  }

  return getWsRpcClient().pi;
}

export function usePiRuntime(environmentId?: EnvironmentId | null) {
  const wsConnectionStatus = useWsConnectionStatus();
  const [snapshot, setSnapshot] = useState<PiRuntimeSnapshot | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const environmentApiReady = useSyncExternalStore(
    subscribeWsRpcClientRegistry,
    () => (environmentId ? Boolean(readEnvironmentApi(environmentId)) : true),
    () => true,
  );

  const requestRuntime = useCallback(
    async (mode: PiRuntimeRequestMode) => {
      const piApi = readPiApi(environmentId);
      const nextSnapshot =
        mode === "refresh" ? await piApi.refreshRuntime() : await piApi.getRuntime();
      setSnapshot(nextSnapshot);
      setCheckedAt(new Date().toISOString());
      return nextSnapshot;
    },
    [environmentId],
  );

  const refreshRuntime = useCallback(async () => {
    setIsRefreshing(true);
    try {
      return await requestRuntime("refresh");
    } finally {
      setIsRefreshing(false);
    }
  }, [requestRuntime]);

  useEffect(() => {
    if (wsConnectionStatus.phase !== "connected") {
      return;
    }

    if (environmentId && !environmentApiReady) {
      return;
    }

    const timerId = window.setTimeout(() => {
      void requestRuntime("get").catch(() => undefined);
    }, 150);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [environmentApiReady, environmentId, requestRuntime, wsConnectionStatus.phase]);

  useEffect(() => {
    if (wsConnectionStatus.phase !== "connected") {
      return;
    }

    const handleWindowFocus = () => {
      void requestRuntime("refresh").catch(() => undefined);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        handleWindowFocus();
      }
    };

    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [requestRuntime, wsConnectionStatus.phase]);

  return {
    snapshot,
    checkedAt,
    isRefreshing,
    refreshRuntime,
  };
}
