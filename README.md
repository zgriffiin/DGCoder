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
