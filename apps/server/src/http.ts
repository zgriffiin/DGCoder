import { Data, Effect, FileSystem, Layer, Option, Path } from "effect";
import {
  HttpBody,
  HttpClient,
  HttpClientResponse,
  HttpRouter,
  HttpServerResponse,
  HttpServerRequest,
} from "effect/unstable/http";
import { OtlpTracer } from "effect/unstable/observability";

import {
  ATTACHMENTS_ROUTE_PREFIX,
  normalizeAttachmentRelativePath,
  resolveAttachmentRelativePath,
} from "./attachmentPaths";
import { resolveAttachmentPathById } from "./attachmentStore";
import { isRequestAuthorized, unauthorizedResponse } from "./auth";
import { ServerConfig } from "./config";
import { decodeOtlpTraceRecords } from "./observability/TraceRecord.ts";
import { BrowserTraceCollector } from "./observability/Services/BrowserTraceCollector.ts";
import { ProjectFaviconResolver } from "./project/Services/ProjectFaviconResolver";

const PROJECT_FAVICON_CACHE_CONTROL = "public, max-age=3600";
const FALLBACK_PROJECT_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#6b728080" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-fallback="project-favicon"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z"/></svg>`;
const OTLP_TRACES_PROXY_PATH = "/api/observability/v1/traces";
const OTLP_TRACES_MAX_BODY_BYTES = 256 * 1024;
const STATIC_HTML_CACHE_CONTROL = "no-cache";
const STATIC_ASSET_CACHE_CONTROL = "public, max-age=3600";
const STATIC_IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const IMMUTABLE_STATIC_ASSET_PATTERN = /[.-][a-z0-9_-]{8,}\./i;

class DecodeOtlpTraceRecordsError extends Data.TaggedError("DecodeOtlpTraceRecordsError")<{
  readonly cause: unknown;
  readonly bodyJson: OtlpTracer.TraceData;
}> {}

class OtlpTraceRequestBodyTooLargeError extends Data.TaggedError(
  "OtlpTraceRequestBodyTooLargeError",
)<{
  readonly maxBytes: number;
}> {}

class ParseOtlpTraceRequestBodyError extends Data.TaggedError("ParseOtlpTraceRequestBodyError")<{
  readonly cause: unknown;
}> {}

function isLoopbackHostname(hostname: string): boolean {
  const normalizedHostname = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    normalizedHostname === "localhost" ||
    normalizedHostname === "127.0.0.1" ||
    normalizedHostname === "::1"
  );
}

function isAllowedOtlpCorsOrigin(
  request: HttpServerRequest.HttpServerRequest,
  origin: string,
): boolean {
  try {
    const parsedOrigin = new URL(origin);
    if (parsedOrigin.protocol === "t3:") {
      return true;
    }

    if (
      (parsedOrigin.protocol === "http:" || parsedOrigin.protocol === "https:") &&
      isLoopbackHostname(parsedOrigin.hostname)
    ) {
      return true;
    }

    const requestUrl = HttpServerRequest.toURL(request);
    return Option.isSome(requestUrl) && requestUrl.value.origin === parsedOrigin.origin;
  } catch {
    return false;
  }
}

function getAllowedOtlpCorsOrigin(
  request: HttpServerRequest.HttpServerRequest,
): string | null | undefined {
  const origin = request.headers.origin?.trim();
  if (!origin) {
    return undefined;
  }

  return isAllowedOtlpCorsOrigin(request, origin) ? origin : null;
}

function getOtlpCorsHeaders(request: HttpServerRequest.HttpServerRequest): Record<string, string> {
  const allowedOrigin = getAllowedOtlpCorsOrigin(request);
  if (!allowedOrigin) {
    return {};
  }

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type",
    Vary: "Origin",
  };
}

function getStaticCacheControl(filePath: string, path: Path.Path): string {
  const basename = path.basename(filePath);
  if (basename === "index.html") {
    return STATIC_HTML_CACHE_CONTROL;
  }

  return IMMUTABLE_STATIC_ASSET_PATTERN.test(basename)
    ? STATIC_IMMUTABLE_CACHE_CONTROL
    : STATIC_ASSET_CACHE_CONTROL;
}

const readOtlpTraceRequestBodyJson = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const contentLengthHeader = request.headers["content-length"];
    const contentLength =
      contentLengthHeader === undefined ? NaN : Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(contentLength) && contentLength > OTLP_TRACES_MAX_BODY_BYTES) {
      return yield* new OtlpTraceRequestBodyTooLargeError({
        maxBytes: OTLP_TRACES_MAX_BODY_BYTES,
      });
    }

    const bodyText = yield* request.text.pipe(
      Effect.mapError((cause) => new ParseOtlpTraceRequestBodyError({ cause })),
    );
    if (Buffer.byteLength(bodyText, "utf8") > OTLP_TRACES_MAX_BODY_BYTES) {
      return yield* new OtlpTraceRequestBodyTooLargeError({
        maxBytes: OTLP_TRACES_MAX_BODY_BYTES,
      });
    }

    return yield* Effect.try({
      try: () => JSON.parse(bodyText) as OtlpTracer.TraceData,
      catch: (cause) => new ParseOtlpTraceRequestBodyError({ cause }),
    });
  });

const serveStaticFile = (filePath: string, cacheControl: string) =>
  HttpServerResponse.file(filePath, {
    status: 200,
    headers: {
      "Cache-Control": cacheControl,
    },
  }).pipe(
    Effect.catch(() =>
      Effect.succeed(HttpServerResponse.text("Internal Server Error", { status: 500 })),
    ),
  );

export const otlpTracesProxyRouteLayer = Layer.mergeAll(
  HttpRouter.add(
    "OPTIONS",
    OTLP_TRACES_PROXY_PATH,
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const allowedOrigin = getAllowedOtlpCorsOrigin(request);
      if (allowedOrigin === null) {
        return HttpServerResponse.text("Forbidden origin", { status: 403 });
      }

      return HttpServerResponse.empty({
        status: 204,
        headers: getOtlpCorsHeaders(request),
      });
    }),
  ),
  HttpRouter.add(
    "POST",
    OTLP_TRACES_PROXY_PATH,
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const config = yield* ServerConfig;
      if (!isRequestAuthorized(request, config.authToken)) {
        return unauthorizedResponse("Unauthorized trace export request");
      }

      const allowedOrigin = getAllowedOtlpCorsOrigin(request);
      if (allowedOrigin === null) {
        return HttpServerResponse.text("Forbidden origin", { status: 403 });
      }

      const corsHeaders = getOtlpCorsHeaders(request);
      const otlpTracesUrl = config.otlpTracesUrl;
      const browserTraceCollector = yield* BrowserTraceCollector;
      const httpClient = yield* HttpClient.HttpClient;
      const bodyJsonResult = yield* readOtlpTraceRequestBodyJson(request).pipe(
        Effect.map((bodyJson) => ({ ok: true as const, bodyJson })),
        Effect.catch((error) => Effect.succeed({ ok: false as const, error })),
      );
      if (!bodyJsonResult.ok) {
        if (bodyJsonResult.error._tag === "OtlpTraceRequestBodyTooLargeError") {
          return HttpServerResponse.text(
            `Trace payload exceeds ${bodyJsonResult.error.maxBytes} bytes.`,
            {
              status: 413,
              headers: corsHeaders,
            },
          );
        }

        return HttpServerResponse.text("Invalid OTLP trace payload.", {
          status: 400,
          headers: corsHeaders,
        });
      }
      const bodyJson = bodyJsonResult.bodyJson;

      yield* Effect.try({
        try: () => decodeOtlpTraceRecords(bodyJson),
        catch: (cause) => new DecodeOtlpTraceRecordsError({ cause, bodyJson }),
      }).pipe(
        Effect.flatMap((records) => browserTraceCollector.record(records)),
        Effect.catch((cause) =>
          Effect.logWarning("Failed to decode browser OTLP traces", {
            cause,
            bodyJson,
          }),
        ),
      );

      if (otlpTracesUrl === undefined) {
        return HttpServerResponse.empty({
          status: 204,
          headers: corsHeaders,
        });
      }

      return yield* httpClient
        .post(otlpTracesUrl, {
          body: HttpBody.jsonUnsafe(bodyJson),
        })
        .pipe(
          Effect.flatMap(HttpClientResponse.filterStatusOk),
          Effect.as(
            HttpServerResponse.empty({
              status: 204,
              headers: corsHeaders,
            }),
          ),
          Effect.tapError((cause) =>
            Effect.logWarning("Failed to export browser OTLP traces", {
              cause,
              otlpTracesUrl,
            }),
          ),
          Effect.catch(() =>
            Effect.succeed(
              HttpServerResponse.text("Trace export failed.", {
                status: 502,
                headers: corsHeaders,
              }),
            ),
          ),
        );
    }),
  ),
);

export const attachmentsRouteLayer = HttpRouter.add(
  "GET",
  `${ATTACHMENTS_ROUTE_PREFIX}/*`,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const config = yield* ServerConfig;
    if (!isRequestAuthorized(request, config.authToken)) {
      return unauthorizedResponse("Unauthorized attachment request");
    }

    const rawRelativePath = url.value.pathname.slice(ATTACHMENTS_ROUTE_PREFIX.length);
    const normalizedRelativePath = normalizeAttachmentRelativePath(rawRelativePath);
    if (!normalizedRelativePath) {
      return HttpServerResponse.text("Invalid attachment path", { status: 400 });
    }

    const isIdLookup =
      !normalizedRelativePath.includes("/") && !normalizedRelativePath.includes(".");
    const filePath = isIdLookup
      ? resolveAttachmentPathById({
          attachmentsDir: config.attachmentsDir,
          attachmentId: normalizedRelativePath,
        })
      : resolveAttachmentRelativePath({
          attachmentsDir: config.attachmentsDir,
          relativePath: normalizedRelativePath,
        });
    if (!filePath) {
      return HttpServerResponse.text(isIdLookup ? "Not Found" : "Invalid attachment path", {
        status: isIdLookup ? 404 : 400,
      });
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const fileInfo = yield* fileSystem
      .stat(filePath)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (!fileInfo || fileInfo.type !== "File") {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }

    return yield* HttpServerResponse.file(filePath, {
      status: 200,
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    }).pipe(
      Effect.catch(() =>
        Effect.succeed(HttpServerResponse.text("Internal Server Error", { status: 500 })),
      ),
    );
  }),
);

export const projectFaviconRouteLayer = HttpRouter.add(
  "GET",
  "/api/project-favicon",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const config = yield* ServerConfig;
    if (!isRequestAuthorized(request, config.authToken)) {
      return unauthorizedResponse("Unauthorized project favicon request");
    }

    const projectCwd = url.value.searchParams.get("cwd");
    if (!projectCwd) {
      return HttpServerResponse.text("Missing cwd parameter", { status: 400 });
    }

    const faviconResolver = yield* ProjectFaviconResolver;
    const faviconFilePath = yield* faviconResolver.resolvePath(projectCwd);
    if (!faviconFilePath) {
      return HttpServerResponse.text(FALLBACK_PROJECT_FAVICON_SVG, {
        status: 200,
        contentType: "image/svg+xml",
        headers: {
          "Cache-Control": PROJECT_FAVICON_CACHE_CONTROL,
        },
      });
    }

    return yield* HttpServerResponse.file(faviconFilePath, {
      status: 200,
      headers: {
        "Cache-Control": PROJECT_FAVICON_CACHE_CONTROL,
      },
    }).pipe(
      Effect.catch(() =>
        Effect.succeed(HttpServerResponse.text("Internal Server Error", { status: 500 })),
      ),
    );
  }),
);

export const staticAndDevRouteLayer = HttpRouter.add(
  "GET",
  "*",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const config = yield* ServerConfig;
    if (config.devUrl) {
      return HttpServerResponse.redirect(config.devUrl.href, { status: 302 });
    }

    if (!config.staticDir) {
      return HttpServerResponse.text("No static directory configured and no dev URL set.", {
        status: 503,
      });
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const staticRoot = path.resolve(config.staticDir);
    const staticRequestPath = url.value.pathname === "/" ? "/index.html" : url.value.pathname;
    const rawStaticRelativePath = staticRequestPath.replace(/^[/\\]+/, "");
    const hasRawLeadingParentSegment = rawStaticRelativePath.startsWith("..");
    const staticRelativePath = path.normalize(rawStaticRelativePath).replace(/^[/\\]+/, "");
    const hasPathTraversalSegment = staticRelativePath.startsWith("..");
    if (
      staticRelativePath.length === 0 ||
      hasRawLeadingParentSegment ||
      hasPathTraversalSegment ||
      staticRelativePath.includes("\0")
    ) {
      return HttpServerResponse.text("Invalid static file path", { status: 400 });
    }

    const isWithinStaticRoot = (candidate: string) =>
      candidate === staticRoot ||
      candidate.startsWith(staticRoot.endsWith(path.sep) ? staticRoot : `${staticRoot}${path.sep}`);

    let filePath = path.resolve(staticRoot, staticRelativePath);
    if (!isWithinStaticRoot(filePath)) {
      return HttpServerResponse.text("Invalid static file path", { status: 400 });
    }

    const ext = path.extname(filePath);
    if (!ext) {
      filePath = path.resolve(filePath, "index.html");
      if (!isWithinStaticRoot(filePath)) {
        return HttpServerResponse.text("Invalid static file path", { status: 400 });
      }
    }

    const fileInfo = yield* fileSystem
      .stat(filePath)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (!fileInfo || fileInfo.type !== "File") {
      const indexPath = path.resolve(staticRoot, "index.html");
      const indexInfo = yield* fileSystem
        .stat(indexPath)
        .pipe(Effect.catch(() => Effect.succeed(null)));
      if (!indexInfo || indexInfo.type !== "File") {
        return HttpServerResponse.text("Not Found", { status: 404 });
      }
      return yield* serveStaticFile(indexPath, STATIC_HTML_CACHE_CONTROL);
    }

    return yield* serveStaticFile(filePath, getStaticCacheControl(filePath, path));
  }),
);
