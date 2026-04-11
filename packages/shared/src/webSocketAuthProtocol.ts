const WEBSOCKET_AUTH_PROTOCOL_PREFIX = "t3-auth.";

function encodeBase64(binary: string): string {
  if (typeof globalThis.btoa === "function") {
    return globalThis.btoa(binary);
  }

  return Buffer.from(binary, "binary").toString("base64");
}

function decodeBase64(encoded: string): string {
  if (typeof globalThis.atob === "function") {
    return globalThis.atob(encoded);
  }

  return Buffer.from(encoded, "base64").toString("binary");
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return encodeBase64(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function fromBase64Url(encoded: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded)) {
    return null;
  }

  const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");

  try {
    const binary = decodeBase64(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

function splitProtocols(value: string): ReadonlyArray<string> {
  return value
    .split(",")
    .map((protocol) => protocol.trim())
    .filter((protocol) => protocol.length > 0);
}

export function resolveWebSocketAuthProtocol(token: string | null | undefined): string | null {
  if (!token) {
    return null;
  }

  const trimmed = token.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return `${WEBSOCKET_AUTH_PROTOCOL_PREFIX}${toBase64Url(new TextEncoder().encode(trimmed))}`;
}

export function readWebSocketAuthTokenFromProtocols(
  protocols: string | ReadonlyArray<string> | null | undefined,
): string | null {
  const candidates =
    typeof protocols === "string"
      ? splitProtocols(protocols)
      : Array.isArray(protocols)
        ? protocols
        : [];

  for (const protocol of candidates) {
    if (!protocol.startsWith(WEBSOCKET_AUTH_PROTOCOL_PREFIX)) {
      continue;
    }

    const encodedToken = protocol.slice(WEBSOCKET_AUTH_PROTOCOL_PREFIX.length);
    const bytes = fromBase64Url(encodedToken);
    if (!bytes) {
      continue;
    }

    try {
      const token = new TextDecoder().decode(bytes).trim();
      if (token.length > 0) {
        return token;
      }
    } catch {
      continue;
    }
  }

  return null;
}
