import { describe, expect, it } from "vitest";

import {
  readWebSocketAuthTokenFromProtocols,
  resolveWebSocketAuthProtocol,
} from "./webSocketAuthProtocol";

describe("webSocketAuthProtocol", () => {
  it("encodes auth tokens into websocket-safe protocol values", () => {
    expect(resolveWebSocketAuthProtocol("secret-token")).toBe("t3-auth.c2VjcmV0LXRva2Vu");
  });

  it("decodes auth tokens from a websocket protocol header", () => {
    expect(
      readWebSocketAuthTokenFromProtocols("rpc.v1, t3-auth.c2VjcmV0LXRva2Vu, another-protocol"),
    ).toBe("secret-token");
  });

  it("returns null when no auth protocol is present", () => {
    expect(readWebSocketAuthTokenFromProtocols(["rpc.v1"])).toBeNull();
  });

  it("ignores malformed auth protocol payloads", () => {
    expect(readWebSocketAuthTokenFromProtocols("t3-auth.not/base64")).toBeNull();
  });
});
