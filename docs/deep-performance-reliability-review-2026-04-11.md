# Deep Performance and Reliability Review

Date: 2026-04-11

Scope reviewed:

- Validation of the earlier 2026-04-11 codebase review findings against current `main`
- Server transport/auth, orchestration snapshot/replay, terminal lifecycle, persistence, observability buffering
- Selected client WebSocket/token handling paths tied to the earlier findings

This document is review-only. No application code changes were made as part of this pass.

## Validation of Earlier Findings

### Fully addressed

#### 1. Protected HTTP routes now require auth

Status: fixed

Evidence:

- `apps/server/src/http.ts:199-201`
- `apps/server/src/http.ts:294-296`
- `apps/server/src/http.ts:353-355`
- `apps/server/src/server.test.ts:615-662`

What changed:

- `POST /api/observability/v1/traces`, `GET /attachments/*`, and `GET /api/project-favicon` now all check `isRequestAuthorized(...)`.
- There is a dedicated test covering unauthorized and authorized access for the protected HTTP routes.

Validation:

- `bunx vitest run src/server.test.ts` passed in `apps/server`.

#### 2. OTLP ingestion now has origin checks and a body cap

Status: fixed

Evidence:

- `apps/server/src/http.ts:171-279`
- `apps/server/src/http.ts:124-156`

What changed:

- The OTLP route now restricts CORS origins instead of allowing broad cross-origin access.
- The request body is capped at `256 * 1024` bytes and returns `413` on oversized payloads.
- Auth is enforced before export forwarding.

Validation:

- Covered by the server test suite run above.

#### 3. Static file responses now stream via `HttpServerResponse.file`

Status: fixed

Evidence:

- `apps/server/src/http.ts:159-169`
- `apps/server/src/http.ts:330-339`
- `apps/server/src/http.ts:375-380`

What changed:

- Static assets, attachments, and favicon responses now use file responses instead of eagerly loading bytes into userland memory.
- Cache policy handling is also clearer and more explicit.

#### 4. Snapshot windows and replay batching were added

Status: mostly fixed

Evidence:

- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts:223-389`
- `packages/shared/src/threadHistoryWindow.ts:1-5`
- `apps/server/src/ws.ts:487-506`

What changed:

- Snapshot loading now windows messages, proposed plans, activities, and checkpoints per thread.
- Replay is capped to `ORCHESTRATION_REPLAY_BATCH_SIZE = 500`.

Residual concern:

- Latest-turn loading is still unbounded and remains a meaningful performance cost. See deeper finding 1 below.

#### 5. Client-side WebSocket URL display is now redacted

Status: mostly fixed

Evidence:

- `apps/web/src/rpc/wsConnectionState.ts:89-98`
- `apps/web/src/rpc/protocol.ts:27-37`

What changed:

- The client no longer stores the raw socket URL directly in connection state.

Validation:

- `bunx vitest run src/lib/utils.test.ts src/rpc/wsConnectionState.test.ts src/wsTransport.test.ts` passed in `apps/web`.

Residual concern:

- The server still accepts `?token=` query auth, so the auth secret still lives in URLs on the wire and in some tests. See deeper finding 6 below.

### Partially addressed or still open

#### 6. Repository identity resolution still shells out during snapshot generation

Status: still open

Evidence:

- `apps/server/src/project/Layers/RepositoryIdentityResolver.ts:93-127`
- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts:661-668`

What changed:

- Positive TTL was increased to 15 minutes, which helps.

What remains:

- Snapshot generation still depends on `git rev-parse` and `git remote -v` subprocess work per project on cache miss.

## Deeper Findings

### 1. Snapshot generation still scans all turns to discover each thread's latest turn

Severity: high

Evidence:

- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts:393-411`
- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts:688-699`

Why it matters:

- Messages, activities, proposed plans, and checkpoints are now windowed, but `listLatestTurnRows` still selects every row from `projection_turns` and sorts all turns by `thread_id`, `requested_at DESC`, and `turn_id DESC`.
- The code then discards almost all of those rows in memory once the first row for each thread is seen.
- On large histories, bootstrap cost will still grow with total turn count, even when the visible thread windows stay small.

Recommended direction:

- Replace this query with a windowed or grouped query that returns only the latest turn per thread at the SQL level.
- Add a regression benchmark for snapshot latency as total turn count grows.

### 2. The orchestration engine still has unbounded in-memory command and event queues

Severity: high

Evidence:

- `apps/server/src/orchestration/Layers/OrchestrationEngine.ts:82-83`
- `apps/server/src/orchestration/Layers/OrchestrationEngine.ts:287-291`

Why it matters:

- Commands are serialized through one worker, but ingress uses `Queue.unbounded`.
- Domain events are also fanned out through `PubSub.unbounded`.
- Under client spam, reconnect storms, or a slow projection/persistence cycle, memory growth is limited only by process memory instead of by explicit backpressure or admission control.

Scenarios:

- A buggy client retries `dispatchCommand` aggressively.
- Provider-side event production outruns consumers for a sustained period.
- SQLite stalls briefly and pending commands accumulate.

Recommended direction:

- Add bounded queues or overload shedding at ingress.
- Record queue depth metrics and alert on sustained growth.
- Decide explicitly whether overload should backpressure, reject, or disconnect.

### 3. Terminal subprocess polling scales poorly with the number of live terminals

Severity: high

Evidence:

- `apps/server/src/terminal/Layers/Manager.ts:302-325`
- `apps/server/src/terminal/Layers/Manager.ts:328-389`
- `apps/server/src/terminal/Layers/Manager.ts:1449-1535`

Why it matters:

- Every second, the terminal manager polls every running terminal to detect subprocess activity.
- On Windows this launches a PowerShell `Get-CimInstance` process per terminal.
- On POSIX it launches `pgrep`, and may fall back to `ps`, again per terminal.
- The checks run with `concurrency: "unbounded"`.

Scenarios:

- A workspace with dozens of active terminals.
- Background setup scripts or long-lived shells left open for many threads.
- Slower machines where these one-second polling subprocesses begin to contend with the actual terminal workload.

Recommended direction:

- Move to event-driven subprocess tracking where possible.
- If polling must remain, batch it, cap concurrency tightly, and use a longer interval for idle sessions.
- Add metrics for subprocess-check duration and poll fan-out.

### 4. Trace buffering can grow without bound when disk writes keep failing

Severity: medium-high

Evidence:

- `apps/server/src/observability/TraceSink.ts:29-43`
- `apps/server/src/observability/TraceSink.ts:55-60`

Why it matters:

- On each flush, the buffer is joined into one string and cleared.
- If `sink.write(chunk)` throws, that whole chunk is pushed back into memory with `buffer.unshift(chunk)`.
- New trace records continue to append, so a persistent disk failure can turn tracing into an unbounded memory sink.

Scenarios:

- Disk full
- Permission changes on the logs directory
- Repeated rotation/write failures on a busy system

Recommended direction:

- Add a maximum in-memory trace backlog in bytes.
- Drop or sample traces after the cap is reached and emit a single health warning.
- Expose sink write failures as a visible health signal instead of silently accumulating.

### 5. Repository identity resolution still blocks snapshot work on Git subprocesses

Severity: medium

Evidence:

- `apps/server/src/project/Layers/RepositoryIdentityResolver.ts:93-127`
- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts:661-668`

Why it matters:

- Even with the longer TTL, cache misses still force subprocess calls inside snapshot assembly.
- Snapshot latency therefore depends on both SQLite and the local Git environment.
- This is especially noticeable after TTL expiry, fresh startup, or many distinct projects.

Recommended direction:

- Persist repository identity in projection state and refresh it only when project metadata changes.
- At minimum, make cache misses observable via metrics so the real frequency is known.

### 6. Query-string auth remains supported, so the bearer token still exists in URLs

Severity: medium

Evidence:

- `apps/server/src/auth.ts:21-39`
- `apps/server/src/server.test.ts:646-653`

Why it matters:

- The client-side display leak was reduced, but the transport still accepts `?token=...`.
- URL-based bearer tokens remain easier to leak through browser history, reverse-proxy logs, screenshots, or ad hoc debugging.
- The current tests explicitly rely on query-token auth, which increases the chance the fallback remains indefinitely.

Recommended direction:

- Deprecate query-string auth and move fully to `Authorization: Bearer`.
- Keep URL redaction as defense in depth, but stop treating query tokens as a first-class path.

### 7. Settings persistence is less robust than keybindings persistence on Windows

Severity: medium

Evidence:

- `apps/server/src/serverSettings.ts:193-209`
- `apps/server/src/keybindings.ts:603-676`

Why it matters:

- `keybindings.ts` has Windows-aware retry/backup handling for file replacement.
- `serverSettings.ts` uses a simpler temp-write then rename flow without the same rename recovery path.
- That asymmetry increases the chance that settings writes fail intermittently on Windows machines where editors, antivirus, or indexing software briefly hold the file.

Recommended direction:

- Reuse the hardened atomic-write path from keybindings for settings.
- Add Windows-specific tests around repeated writes and external file churn.

### 8. Git status fan-out is global, so every subscriber pays for unrelated repository events

Severity: low-medium

Evidence:

- `apps/server/src/git/Layers/GitStatusBroadcaster.ts:68-111`
- `apps/server/src/git/Layers/GitStatusBroadcaster.ts:241-264`

Why it matters:

- The broadcaster uses one global unbounded `PubSub` and filters by `cwd` after subscription.
- That means each subscriber still wakes for every published repo status change, even for unrelated repositories.
- This is not a crisis at small scale, but it becomes avoidable work in multi-repo or multi-subscriber sessions.

Recommended direction:

- Partition channels by normalized `cwd`, or keep per-repo pubsubs.
- If the current design remains, at least add metrics for subscriber counts and event fan-out.

## Suggested Priorities

1. Fix latest-turn snapshot loading so snapshot cost truly scales with the thread windows.
2. Bound or instrument the orchestration queues before overload becomes a memory problem.
3. Rework terminal subprocess polling; it is the most obvious recurring per-terminal tax.
4. Put hard caps on trace sink backlog and deprecate query-string auth.
5. Normalize Windows-safe atomic file writing across settings and keybindings.

## Validation Commands Run

- `bunx vitest run src/server.test.ts` in `apps/server`
- `bunx vitest run src/lib/utils.test.ts src/rpc/wsConnectionState.test.ts src/wsTransport.test.ts` in `apps/web`
