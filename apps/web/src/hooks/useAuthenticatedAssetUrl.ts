import { useEffect, useState } from "react";

import { resolveServerAuthorizationHeader } from "../lib/serverAuth";

type AuthenticatedAssetStatus = "idle" | "loading" | "ready" | "error";

function doesNotNeedAuthProxy(src: string, authorization: string | null): boolean {
  return authorization === null || src.startsWith("blob:") || src.startsWith("data:");
}

export function useAuthenticatedAssetUrl(rawSrc: string | null | undefined): {
  readonly src: string | undefined;
  readonly status: AuthenticatedAssetStatus;
} {
  const authorization = resolveServerAuthorizationHeader();
  const needsProxy =
    typeof rawSrc === "string" && rawSrc.length > 0 && !doesNotNeedAuthProxy(rawSrc, authorization);

  const [state, setState] = useState<{
    readonly src: string | undefined;
    readonly status: AuthenticatedAssetStatus;
  }>(() => {
    if (!rawSrc) {
      return { src: undefined, status: "idle" };
    }
    if (!needsProxy) {
      return { src: rawSrc, status: "ready" };
    }
    return { src: undefined, status: "loading" };
  });

  useEffect(() => {
    if (!rawSrc) {
      setState({ src: undefined, status: "idle" });
      return;
    }

    if (!needsProxy || authorization === null) {
      setState({ src: rawSrc, status: "ready" });
      return;
    }

    const abortController = new AbortController();
    let objectUrl: string | null = null;
    setState({ src: undefined, status: "loading" });

    void fetch(rawSrc, {
      headers: {
        Authorization: authorization,
      },
      signal: abortController.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to load authenticated asset: ${response.status}`);
        }
        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        setState({ src: objectUrl, status: "ready" });
      })
      .catch((error) => {
        if (abortController.signal.aborted) {
          return;
        }
        console.warn("Failed to load authenticated asset", {
          error: error instanceof Error ? error.message : String(error),
          rawSrc,
        });
        setState({ src: undefined, status: "error" });
      });

    return () => {
      abortController.abort();
      if (objectUrl !== null) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [authorization, needsProxy, rawSrc]);

  return state;
}
