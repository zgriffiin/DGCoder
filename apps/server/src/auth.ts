import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { readWebSocketAuthTokenFromProtocols } from "@t3tools/shared/webSocketAuthProtocol";

const AUTHORIZATION_BEARER_PREFIX = "bearer ";

function readBearerToken(request: HttpServerRequest.HttpServerRequest): string | null {
  const authorization = request.headers.authorization?.trim();
  if (!authorization) {
    return null;
  }

  const normalizedAuthorization = authorization.toLowerCase();
  if (!normalizedAuthorization.startsWith(AUTHORIZATION_BEARER_PREFIX)) {
    return null;
  }

  const token = authorization.slice(AUTHORIZATION_BEARER_PREFIX.length).trim();
  return token.length > 0 ? token : null;
}

function readWebSocketProtocolToken(request: HttpServerRequest.HttpServerRequest): string | null {
  const token = readWebSocketAuthTokenFromProtocols(
    request.headers["sec-websocket-protocol"] ?? null,
  );
  return token && token.length > 0 ? token : null;
}

export function isRequestAuthorized(
  request: HttpServerRequest.HttpServerRequest,
  authToken: string | undefined,
  options?: {
    readonly allowWebSocketProtocolToken?: boolean;
  },
): boolean {
  if (!authToken) {
    return true;
  }

  if (readBearerToken(request) === authToken) {
    return true;
  }

  return (
    options?.allowWebSocketProtocolToken === true &&
    readWebSocketProtocolToken(request) === authToken
  );
}

export function unauthorizedResponse(message: string, headers?: Record<string, string>) {
  return HttpServerResponse.text(message, {
    status: 401,
    headers: {
      ...headers,
      "WWW-Authenticate": "Bearer",
    },
  });
}
