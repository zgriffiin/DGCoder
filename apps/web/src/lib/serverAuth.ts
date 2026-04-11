import { String, Predicate } from "effect";
import { resolveWebSocketAuthProtocol } from "@t3tools/shared/webSocketAuthProtocol";

import { resolvePrimaryEnvironmentBootstrapUrl } from "../environmentBootstrap";

const AUTHORIZATION_BEARER_PREFIX = "Bearer ";
const AUTH_TOKEN_QUERY_PARAM = "token";
const isNonEmptyString = Predicate.compose(Predicate.isString, String.isNonEmpty);
let cachedServerAuthToken: string | null = null;

function resolveServerBootstrapUrl(url?: string): string {
  return isNonEmptyString(url) ? url : resolvePrimaryEnvironmentBootstrapUrl();
}

function parseServerAuthToken(url: string): string | null {
  try {
    const parsedUrl = new URL(url);
    const token = parsedUrl.searchParams.get(AUTH_TOKEN_QUERY_PARAM)?.trim();
    return token && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

export function resolveServerAuthToken(url?: string): string | null {
  if (isNonEmptyString(url)) {
    const explicitToken = parseServerAuthToken(url);
    if (explicitToken) {
      cachedServerAuthToken = explicitToken;
      return explicitToken;
    }
  }

  if (cachedServerAuthToken) {
    return cachedServerAuthToken;
  }

  const bootstrapToken = parseServerAuthToken(resolveServerBootstrapUrl(url));
  if (bootstrapToken) {
    cachedServerAuthToken = bootstrapToken;
    return bootstrapToken;
  }

  if (typeof window !== "undefined") {
    const currentLocationToken = parseServerAuthToken(window.location.href);
    if (currentLocationToken) {
      cachedServerAuthToken = currentLocationToken;
      return currentLocationToken;
    }
  }

  return null;
}

export function resolveServerAuthorizationHeader(url?: string): string | null {
  const token = resolveServerAuthToken(url);
  return token ? `${AUTHORIZATION_BEARER_PREFIX}${token}` : null;
}

export function resolveServerAuthHeaders(url?: string): Record<string, string> | undefined {
  const authorization = resolveServerAuthorizationHeader(url);
  return authorization ? { Authorization: authorization } : undefined;
}

export function resolveServerWebSocketProtocols(url?: string): ReadonlyArray<string> | undefined {
  const protocol = resolveWebSocketAuthProtocol(resolveServerAuthToken(url));
  return protocol ? [protocol] : undefined;
}

export function stripServerAuthTokenFromCurrentUrl(): void {
  try {
    const currentUrl = new URL(window.location.href);
    const token = currentUrl.searchParams.get(AUTH_TOKEN_QUERY_PARAM)?.trim();
    if (!token) {
      return;
    }

    cachedServerAuthToken = token;
    currentUrl.searchParams.delete(AUTH_TOKEN_QUERY_PARAM);
    const nextUrl = `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`;
    window.history.replaceState(window.history.state, "", nextUrl);
  } catch {
    return;
  }
}
