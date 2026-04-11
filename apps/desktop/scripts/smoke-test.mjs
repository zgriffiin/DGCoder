import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path, { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WS_METHODS, WsRpcGroup } from "@t3tools/contracts";
import { resolveWebSocketAuthProtocol } from "@t3tools/shared/webSocketAuthProtocol";
import { Effect, Layer } from "effect";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import * as Socket from "effect/unstable/socket/Socket";
import { resolveElectronPath } from "./electron-launcher.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(__dirname, "..");
const electronBin = resolveElectronPath();
const mainJs = resolve(desktopDir, "dist-electron/main.js");
const serverDistDir = resolve(desktopDir, "../server/dist");
const smokeHome = mkdtempSync(path.join(os.tmpdir(), "t3-desktop-smoke-"));
const serverChildLogPath = path.join(smokeHome, "userdata", "logs", "server-child.log");
const smokeBackendAuthToken = "smoke-test-backend-auth-token";
const SMOKE_TEST_TOTAL_TIMEOUT_MS = 20_000;
const SMOKE_TEST_SERVER_CONFIG_TIMEOUT_MS = 15_000;

console.log("\nLaunching Electron smoke test...");

function validateBundledServerSupport() {
  const serverBundlePath = resolve(serverDistDir, "bin.mjs");
  const bundleText = readFileSync(serverBundlePath, "utf8");
  const requiredPatterns = [/"codex"/, /"claudeAgent"/, /"kiro"/, /"amazonQ"/, /kiro-cli/];
  const missingPatterns = requiredPatterns.filter((pattern) => !pattern.test(bundleText));

  if (missingPatterns.length > 0) {
    throw new Error("Bundled desktop server is missing required provider support markers.");
  }
}

validateBundledServerSupport();

const makeWsRpcClient = RpcClient.make(WsRpcGroup);

function createWsRpcProtocolLayer(wsUrl, protocols) {
  const webSocketConstructorLayer = Layer.succeed(
    Socket.WebSocketConstructor,
    (socketUrl, socketProtocols) => new globalThis.WebSocket(socketUrl, socketProtocols),
  );
  const socketLayer = Socket.layerWebSocket(
    wsUrl,
    protocols ? { protocols: [...protocols] } : undefined,
  ).pipe(Layer.provide(webSocketConstructorLayer));

  return RpcClient.layerProtocolSocket().pipe(
    Layer.provide(socketLayer),
    Layer.provide(RpcSerialization.layerJson),
  );
}

async function reserveLoopbackPort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to resolve smoke backend port."));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchServerConfigOnce(wsUrl, requestTimeoutMs) {
  const authProtocol = resolveWebSocketAuthProtocol(smokeBackendAuthToken);
  const requestPromise = makeWsRpcClient.pipe(
    Effect.flatMap((client) => client[WS_METHODS.serverGetConfig]({})),
    Effect.provide(createWsRpcProtocolLayer(wsUrl, authProtocol ? [authProtocol] : undefined)),
    Effect.scoped,
    Effect.runPromise,
  );
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error("Timed out waiting for server config response."));
    }, requestTimeoutMs);
  });

  return await Promise.race([requestPromise, timeoutPromise]);
}

async function waitForServerConfig(wsUrl, totalTimeoutMs) {
  const deadline = Date.now() + totalTimeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      return await fetchServerConfigOnce(wsUrl, Math.min(1_500, deadline - Date.now()));
    } catch (error) {
      lastError = error;
      await delay(200);
    }
  }

  throw lastError ?? new Error("Timed out waiting for packaged desktop backend.");
}

const smokeBackendPort = await reserveLoopbackPort();
const smokeBackendWsUrl = `ws://127.0.0.1:${smokeBackendPort}/ws`;
const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;
delete childEnv.VITE_DEV_SERVER_URL;

const child = spawn(electronBin, [mainJs], {
  stdio: ["pipe", "pipe", "pipe"],
  cwd: desktopDir,
  env: {
    ...childEnv,
    T3CODE_HOME: smokeHome,
    T3CODE_SMOKE_TEST_CAPTURE_BACKEND: "1",
    T3CODE_SMOKE_TEST_BACKEND_PORT: String(smokeBackendPort),
    T3CODE_SMOKE_TEST_BACKEND_AUTH_TOKEN: smokeBackendAuthToken,
    ELECTRON_ENABLE_LOGGING: "1",
  },
});

let output = "";
let fetchedServerConfig = null;
let smokeFailureMessage = null;
child.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

const timeout = setTimeout(() => {
  child.kill();
}, SMOKE_TEST_TOTAL_TIMEOUT_MS);

void (async () => {
  try {
    fetchedServerConfig = await waitForServerConfig(
      smokeBackendWsUrl,
      SMOKE_TEST_SERVER_CONFIG_TIMEOUT_MS,
    );
    if (!Array.isArray(fetchedServerConfig.providers)) {
      throw new Error("server config response did not include provider snapshots");
    }
    if (!fetchedServerConfig.providers.some((provider) => provider?.provider === "kiro")) {
      throw new Error("provider list did not include kiro");
    }
    await delay(2_000);
  } catch (error) {
    smokeFailureMessage = error instanceof Error ? error.message : String(error);
  } finally {
    child.kill();
  }
})();

child.on("exit", () => {
  clearTimeout(timeout);

  const fatalPatterns = [
    "Cannot find module",
    "MODULE_NOT_FOUND",
    "Refused to execute",
    "Uncaught Error",
    "Uncaught TypeError",
    "Uncaught ReferenceError",
  ];
  const failures = fatalPatterns.filter((pattern) => output.includes(pattern));
  if (smokeFailureMessage) {
    failures.push(smokeFailureMessage);
  }
  const backendLog = existsSync(serverChildLogPath) ? readFileSync(serverChildLogPath, "utf8") : "";
  const sessionStarts = (backendLog.match(/APP SESSION START/g) ?? []).length;
  const sessionEnds = (backendLog.match(/APP SESSION END/g) ?? []).length;

  if (fetchedServerConfig === null) {
    failures.push("server config was never fetched from packaged desktop backend");
  }
  if (!backendLog.includes("T3 Code running") && !backendLog.includes("Listening on http://")) {
    failures.push("backend never reached healthy startup");
  }
  if (sessionStarts !== 1) {
    failures.push(`unexpected backend restart count (${sessionStarts} starts)`);
  }
  if (sessionEnds > 1) {
    failures.push(`unexpected backend shutdown count (${sessionEnds} ends)`);
  }
  if (backendLog.includes("BACKEND CRASH LOOP DETECTED")) {
    failures.push("backend crash loop detector tripped during smoke test");
  }
  if (backendLog.includes("Unknown persisted provider 'kiro'")) {
    failures.push("backend still rejected persisted Kiro provider state");
  }

  if (failures.length > 0) {
    console.error("\nDesktop smoke test failed:");
    for (const failure of failures) {
      console.error(` - ${failure}`);
    }
    console.error("\nFull output:\n" + output);
    if (backendLog.length > 0) {
      console.error("\nBackend log:\n" + backendLog);
    }
    rmSync(smokeHome, { recursive: true, force: true });
    process.exit(1);
  }

  console.log("Desktop smoke test passed.");
  rmSync(smokeHome, { recursive: true, force: true });
  process.exit(0);
});
