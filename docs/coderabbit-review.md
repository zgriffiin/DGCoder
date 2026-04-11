# CodeRabbit Review Instructions

Review this repository with these priorities:

- Performance first.
- Reliability first.
- Predictable behavior under load, reconnects, session restarts, and partial streams.
- Correctness and robustness over short-term convenience.
- Long-term maintainability over local one-off fixes.

Focus especially on:

- orchestration and provider lifecycle regressions
- reconnect and recovery edge cases
- JSON-RPC and WebSocket protocol handling
- race conditions, stale state, and duplicate event processing
- resource leaks and failure cleanup
- contract drift between `apps/server`, `apps/web`, and `packages/contracts`
- duplicate logic that should move into a shared module

Repository checks expected before merge:

- `bun fmt`
- `bun lint`
- `bun typecheck`

Package roles:

- `apps/server`: WebSocket server, provider session orchestration, Codex app-server broker
- `apps/web`: React/Vite session UX, event rendering, client-side state
- `packages/contracts`: schema-only shared TypeScript contracts
- `packages/shared`: shared runtime utilities via explicit subpath exports

Prefer high-signal findings:

- correctness bugs
- behavioral regressions
- missing failure handling
- security or permission mistakes
- operational issues that only show up under concurrency or restart conditions

De-emphasize pure style nits unless they hide a real maintainability or correctness risk.
