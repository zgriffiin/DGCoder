# Codebase Review

Date: 2026-04-11

Scope reviewed:

- `apps/server` transport, HTTP, orchestration snapshot/replay, observability, project metadata lookup
- `apps/web` bootstrap and WebSocket transport state
- Representative shared runtime paths

Overall impression:

- The repo already has strong testing coverage in a lot of core paths, and the Effect-based service boundaries are generally clear.
- The biggest risks are around scaling characteristics of orchestration bootstrap/recovery and a few security gaps when the server is exposed beyond localhost.

## Priority Findings

### 1. P1 Security: `authToken` only protects `/ws`, not the other stateful HTTP routes

Relevant code:

- `apps/server/src/ws.ts:841-867`
- `apps/server/src/http.ts:34-183`

Why it matters:

- The configured `authToken` is checked only during the WebSocket handshake.
- `POST /api/observability/v1/traces`, `GET /attachments/*`, and `GET /api/project-favicon?cwd=...` do not perform any auth check.
- If this server is bound to anything other than localhost, an unauthenticated caller can read uploaded attachments, probe local project paths through favicon resolution behavior, and send arbitrary OTLP payloads.

Recommended direction:

- Introduce one shared auth guard for all non-static routes, not just `/ws`.
- Treat static asset serving separately if it is intentionally public.
- Add tests that assert `authToken` protects attachments, project favicon, and observability endpoints too.

### 2. P1 Security/Abuse: the OTLP proxy is cross-origin and unbounded

Relevant code:

- `apps/server/src/http.ts:34-87`

Why it matters:

- The route accepts `request.json` directly, which means the full body is parsed into memory before any validation or size control.
- The same route is wrapped in CORS support and can forward payloads upstream when `otlpTracesUrl` is configured.
- In practice, that gives any web page that can reach the server a way to generate local disk churn, memory pressure, and OTLP egress traffic.

Recommended direction:

- Require auth on this route.
- Enforce a small request body limit before JSON parsing.
- Consider disabling CORS entirely unless there is a concrete browser-origin use case that needs it.
- Rate-limit or sample aggressively if browser trace ingestion stays enabled.

### 3. P1 Performance: bootstrap and recovery scale with total historical data, not active context

Relevant code:

- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts:439-725`
- `apps/server/src/ws.ts:416-506`
- `apps/web/src/routes/__root.tsx:521-589`

Why it matters:

- `getSnapshot()` loads all projects, threads, messages, activities, proposed plans, checkpoints, sessions, and latest turns into one in-memory read model.
- `replayEvents()` collects the full event stream into an array before returning it.
- On the client side, snapshot recovery and replay recovery eagerly request those full payloads during bootstrap and reconnect flows.
- That means reconnect latency, memory use, and network transfer all grow with the entire retained history of the installation instead of the threads the user is actively viewing.

Recommended direction:

- Split the current snapshot into a lightweight shell snapshot and lazy thread-detail fetches.
- Keep replay streaming as a stream instead of materializing the full event list into an array.
- Add pagination or windowing for old messages, activities, and checkpoints.
- Put hard metrics around snapshot size, replay size, and reconnect time before this history grows further.

### 4. P2 Performance: static file serving buffers assets into userland memory

Relevant code:

- `apps/server/src/http.ts:185-260`

Why it matters:

- The static route uses `readFile()` and `HttpServerResponse.uint8Array()` for both normal assets and SPA fallback.
- That copies the full asset into process memory for every request, which is avoidable for JS bundles, images, and other larger files.
- Under load this will increase GC pressure and reduce throughput compared with file streaming or a platform static-file primitive.

Recommended direction:

- Prefer `HttpServerResponse.file()` or a dedicated static middleware so the runtime can stream files efficiently.
- Add cache headers for immutable hashed assets and avoid reading `index.html` into memory on every miss.

### 5. P2 Security: the WebSocket bearer token is carried and stored in URLs

Relevant code:

- `apps/server/src/ws.ts:856-863`
- `apps/web/src/lib/utils.ts:45-67`
- `apps/web/src/rpc/protocol.ts:27-37`
- `apps/web/src/rpc/wsConnectionState.ts:88-97`

Why it matters:

- The current auth model expects `?token=...` on the WebSocket URL.
- Query-string bearer tokens are easy to leak through browser history, reverse-proxy logs, diagnostics, and client-side state.
- The frontend also keeps the full `socketUrl` in reactive state, which means the token can persist longer than necessary in memory and debugging surfaces.

Recommended direction:

- Move auth to a cookie or a short-lived subprotocol/token-exchange mechanism instead of a long-lived query parameter.
- At minimum, redact query strings before storing or logging socket URLs in client state.

### 6. P3 Performance/Quality: repository identity enrichment shells out to Git during snapshot generation

Relevant code:

- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts:661-670`
- `apps/server/src/project/Layers/RepositoryIdentityResolver.ts:77-136`

Why it matters:

- Every snapshot resolves repository identity for each project, and the resolver may call `git rev-parse` plus `git remote -v`.
- There is a cache, but it is only 1 minute for positive results, so reconnect storms or repeated snapshot recovery can still trigger avoidable subprocess work.
- This makes snapshot generation dependent on filesystem and Git latency rather than just SQLite read performance.

Recommended direction:

- Persist repository identity in the projection layer and refresh it only when project metadata changes.
- If that is too large a change right now, raise the cache TTL and instrument how often snapshot generation hits the resolver.

## Suggested Next Steps

1. Close the auth gap for non-static HTTP routes and lock down OTLP ingestion.
2. Redesign snapshot/replay so reconnect cost scales with active threads, not total retained history.
3. Switch static file serving to streaming primitives.
4. Remove bearer tokens from query strings or at least redact them from client state and logs.

## Strengths

- Core orchestration and provider paths are heavily tested relative to the age of the codebase.
- Package boundaries are mostly sensible, especially the contracts/shared split.
- The service/layer approach makes the risky areas fairly easy to isolate once the performance and auth work is prioritized.
