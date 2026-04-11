import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { resolvePrimaryEnvironmentBootstrapUrlMock } = vi.hoisted(() => ({
  resolvePrimaryEnvironmentBootstrapUrlMock: vi.fn(
    () => "http://bootstrap.test:4321/?token=secret-token",
  ),
}));

vi.mock("../environmentBootstrap", () => ({
  resolvePrimaryEnvironmentBootstrapUrl: resolvePrimaryEnvironmentBootstrapUrlMock,
}));

import {
  resolveServerAuthHeaders,
  resolveServerAuthorizationHeader,
  resolveServerAuthToken,
  resolveServerWebSocketProtocols,
  stripServerAuthTokenFromCurrentUrl,
} from "./serverAuth";

const originalWindow = globalThis.window;

describe("serverAuth", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        history: {
          state: { from: "test" },
          replaceState: vi.fn(),
        },
        location: {
          href: "http://localhost:3020/?token=secret-token&foo=bar#/chat",
        },
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  });

  it("resolves bearer auth from the bootstrap url", () => {
    expect(resolveServerAuthToken()).toBe("secret-token");
    expect(resolveServerAuthorizationHeader()).toBe("Bearer secret-token");
    expect(resolveServerAuthHeaders()).toEqual({
      Authorization: "Bearer secret-token",
    });
  });

  it("encodes websocket auth as a negotiated subprotocol", () => {
    expect(resolveServerWebSocketProtocols()).toEqual(["t3-auth.c2VjcmV0LXRva2Vu"]);
  });

  it("strips the token from the browser url while preserving other params and hash", () => {
    stripServerAuthTokenFromCurrentUrl();

    expect(window.history.replaceState).toHaveBeenCalledWith(
      window.history.state,
      "",
      "/?foo=bar#/chat",
    );
  });
});
