import { Option } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

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

function readQueryToken(request: HttpServerRequest.HttpServerRequest): string | null {
  const url = HttpServerRequest.toURL(request);
  if (Option.isNone(url)) {
    return null;
  }

  const token = url.value.searchParams.get("token");
  return token && token.length > 0 ? token : null;
}

export function isRequestAuthorized(
  request: HttpServerRequest.HttpServerRequest,
  authToken: string | undefined,
): boolean {
  if (!authToken) {
    return true;
  }

  return readBearerToken(request) === authToken || readQueryToken(request) === authToken;
}

export function unauthorizedResponse(message: string) {
  return HttpServerResponse.text(message, {
    status: 401,
    headers: {
      "WWW-Authenticate": "Bearer",
    },
  });
}
