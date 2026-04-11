# T3 Code

T3 Code is a minimal web GUI for coding agents. This DGCoder fork is still an early
WIP, focused on provider reliability, recoverable sessions, and local workflow tools
that make long-running agent work easier to inspect. Thanks to the T3 team and the
community for the core application, concepts and helping with understanding this
industry.

Me

I'm not a developer, I am an Engineer (of the electrical/ mechanical type). Theo and
others have helped me get to this point, with AI of course.

## Current State

T3 Code now supports these provider CLIs:

- Codex (`codex`)
- Claude Code (`claude`)
- Kiro (`kiro-cli`)
- Amazon Q (`q`)

The server probes each provider for installation, version, authentication state, and
available models. Providers can be enabled, disabled, or pointed at custom binary paths
from the settings UI.

Recent work in this fork includes:

- Kiro and Amazon Q CLI-agent adapters.
- Provider status/settings for Codex, Claude, Kiro, and Amazon Q.
- Orchestration event recovery fixes for session restart and reconnect flows.
- Resume-triggered snapshot recovery on focus/online/visibility changes, so stale long-running
  sessions re-sync without a full app restart.
- Session completion and diff rendering fixes for smoother long-running threads.
- Snapshot bootstrap now fetches only the latest turn per thread at the SQL layer instead of
  scanning all historical turns in memory.
- Repository identity is now persisted into projection state, so snapshot generation no longer
  shells out to Git on cache misses.
- Orchestration ingress now uses bounded command and event queues instead of unbounded buffers.
- Terminal subprocess polling now caps concurrent checker fan-out, reducing per-second process
  pressure on large terminal sets.
- Trace buffering now has an explicit in-memory cap, so repeated trace-write failures cannot
  grow memory without bound.
- Protected HTTP routes now use bearer-header auth, while WebSocket auth now uses a negotiated
  subprotocol instead of carrying auth tokens in URLs.
- Settings writes now reuse the hardened Windows-safe atomic write path already used by
  keybindings.
- Git status subscriptions now fan out per repository instead of waking all subscribers on
  unrelated repo updates.
- Compact work-log rendering with a detail popup for long tool/output entries.
- Beans workflow management from the UI.
- A post-agent quality gate that records format, lint, typecheck, and code-shape failures.

Expect bugs. The project is moving quickly and is not accepting outside contributions yet.

## Install Provider CLIs

Install and authenticate at least one provider before use:

- Codex: install [Codex CLI](https://github.com/openai/codex) and run `codex login`
- Claude: install Claude Code and run `claude auth login`
- Kiro: install Kiro CLI and run `kiro-cli login`
- Amazon Q: install Amazon Q CLI and run `q login`

Optional workflow tools:

- Beans: install the `beans` CLI if you want to manage `.beans/` issues from the app.

## Run

### Published CLI

```bash
npx t3
```

### Local Development

Prerequisites:

- Bun `^1.3.9`
- Node `^24.13.1`

```bash
bun install
bun dev
```

Useful commands:

```bash
bun dev:server
bun dev:web
bun dev:desktop
bun build
bun build:desktop
```

To see server flags:

```bash
bun --cwd apps/server dev -- --help
```

Remote access options are documented in [REMOTE.md](./REMOTE.md).

## Features

### Agent Sessions

The server wraps provider CLIs behind a shared provider runtime. Codex uses the Codex
app-server protocol; Claude uses the Claude Agent SDK/CLI path; Kiro and Amazon Q use a
shared non-interactive CLI-agent adapter.

Session startup, resume, provider event ingestion, approvals, user-input requests,
interrupts, checkpoint capture, and rollback are coordinated through the orchestration
engine and streamed to the browser over WebSocket push messages.

### Conversation UI

The React app renders conversations, provider activity, proposed plans, image
attachments, terminal context chips, changed-file summaries, checkpoint diffs, and
revert actions.

Work-log rows are compact by default. Long tool details can be opened in a full detail
dialog without expanding the entire timeline.

### Performance And Session Reliability

This fork has focused on keeping the UI responsive and predictable while provider
sessions run, reconnect, or recover from partial streams. Recent fixes include:

- Focus, online, pageshow, and visible-tab transitions now trigger debounced snapshot recovery,
  so the UI resyncs after machine sleep, tab suspension, or missed live events.
- Provider session updates now reconcile the latest turn when a runtime settles, so a
  completed provider session does not keep rendering as still working after refresh or
  restart.
- Snapshot bootstrap now asks SQLite for only the latest turn per thread, which keeps
  recovery cost tied to current thread state instead of total historical turn count.
- Repository identity now comes from persisted projection data during snapshot reads, which
  removes Git subprocesses from the steady-state recovery path.
- Orchestration dispatch and live event fan-out now run through bounded buffers, so overload
  backpressure is explicit instead of process-memory growth being implicit.
- Terminal subprocess polling now caps concurrent checks, which avoids unbounded per-tick
  polling fan-out when many terminals stay open.
- Trace logging now enforces an in-memory backlog cap if file writes fail repeatedly,
  preventing trace persistence failures from turning into an unbounded memory sink.
- Protected HTTP assets and browser OTLP exports now authenticate with bearer headers, while
  WebSocket auth uses a negotiated subprotocol and the browser strips `token` from the visible
  page URL after bootstrap.
- Settings persistence now shares the same Windows-safe atomic write path as keybindings,
  reducing rename races during repeated writes.
- Git status subscriptions now publish per normalized repository path, which avoids waking
  unrelated repo subscribers on every refresh.
- Settled provider states clear stale active-turn ids, while duplicate turn starts are
  still rejected when the session is actually running.
- The chat composer ignores extra send attempts while a turn is running, which prevents
  accidental duplicate submissions from keyboard input during active work.
- The diff panel defaults to the latest turn instead of the whole conversation. Full
  conversation diffs are still available, but only through an explicit scope.
- Diff rendering is unmounted when the diff panel closes, and the diff worker pool/cache
  are capped to reduce UI-thread and memory pressure during large patches.
- Long provider work-log entries stay compact until opened in a detail dialog, avoiding
  oversized timeline rows during heavy tool output.

### Beans

The Beans panel can initialize Beans in the active project, list/search beans, show the
roadmap, create or update beans, archive the project, and generate prompts that split
larger work into child beans. Beans data remains Markdown-backed in `.beans/`.

### Quality Gate

After file-changing agent turns, the server can run a quality gate and append pass/fail
activity to the thread. The default gate checks:

- `bun run fmt:check`
- `bun run lint`
- `bun run typecheck`
- max file lines
- max function lines
- max cyclomatic complexity

Quality-gate settings are configurable from the app settings UI.

### Local CodeRabbit Review

This repo can also enforce local CodeRabbit review before selected Git actions through a
repo-tracked file: `.t3code/project.json`.

Current model:

- GitHub PR review stays in `.github/workflows/coderabbit-review.yml`
- local review policy lives in the repo
- the app enforces that repo policy before commit/push/PR actions
- the app does not store CodeRabbit secrets or auth state

Example config:

```json
{
  "version": 1,
  "localReview": {
    "tool": "coderabbit",
    "command": "coderabbit",
    "args": [
      "review",
      "--plain",
      "--type",
      "committed",
      "--base",
      "{{defaultBranch}}",
      "-c",
      "docs/coderabbit-review.md"
    ],
    "enforceOn": ["commit_push", "commit_push_pr", "create_pr"],
    "timeoutMs": 300000
  }
}
```

Notes:

- authenticate CodeRabbit locally outside the app
- `{{defaultBranch}}` is the only supported token in v1
- local review and GitHub PR review are complementary, not replacements
- invalid `.t3code/project.json` blocks enforced actions until fixed

## Repository Layout

- `apps/server`: Node/Bun WebSocket server, provider adapters, orchestration, persistence,
  git operations, terminal sessions, Beans, quality gate, and observability.
- `apps/web`: React/Vite UI for chat, settings, diffs, terminal context, provider models,
  Beans, and project/thread state.
- `apps/desktop`: Electron shell, desktop startup, shell environment sync, packaging, and
  update flow.
- `apps/marketing`: Astro marketing/download pages.
- `packages/contracts`: Shared Effect Schema contracts only. Keep runtime logic out.
- `packages/shared`: Shared runtime utilities with explicit subpath exports.
- `packages/client-runtime`: Client runtime helpers for scoped environments and known
  environment state.
- `scripts`: Monorepo dev runner, release, desktop artifact, and maintenance scripts.

## Development Checks

Before considering a task complete, run:

```bash
bun fmt
bun lint
bun typecheck
```

Use `bun run test` for Vitest. Do not run `bun test`.

## Docs

- Observability guide: [docs/observability.md](./docs/observability.md)
- Remote access guide: [REMOTE.md](./REMOTE.md)
- Fork maintenance guide: [docs/fork-sync-process.md](./docs/fork-sync-process.md)
- Release process: [docs/release.md](./docs/release.md)
- Keybindings: [KEYBINDINGS.md](./KEYBINDINGS.md)
- Contribution notes: [CONTRIBUTING.md](./CONTRIBUTING.md)

Need support? Join the upstream [Discord](https://discord.gg/jn4EGJjrvv).
