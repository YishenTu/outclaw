# outclaw

A mini OpenClaw: autonomous AI agent powered by the Claude Agent SDK.

## Architecture

- **Common** (`src/common/`): Shared protocol types, serialization, helpers
- **Backend** (`src/backend/`): Facade interface + provider adapters (Claude)
- **Runtime** (`src/runtime/`): WS server, shared active session, SQLite session store, message queue, PID management, heartbeat scheduler, cron scheduler, system prompt assembly
- **Frontend** (`src/frontend/`): TUI (Ink) and Telegram bot connected to the same runtime session
- **CLI** (`src/cli.ts`): `oc` command — start/stop/restart/status/tui/dev

### Runtime neutrality

`src/runtime/` is an orchestration layer and must stay provider neutral.

- Runtime owns scheduling, queueing, session selection, persistence policy, WS fanout, Telegram/TUI delivery coordination, and process lifecycle.
- Backend adapters own provider behavior: run/resume semantics, history replay, provider event translation, provider capabilities, provider-specific setup, and provider-specific storage lookup.
- If runtime needs provider-dependent behavior, extend the backend facade with an explicit method or capability instead of branching on provider identity inside runtime code.
- Runtime must not import provider SDKs or parse provider-native transcript/history formats directly.
- Runtime must not create provider-specific filesystem artifacts or assume a specific provider directory layout.
- Persist provider ownership alongside any provider session identifier. Never assume a single global provider namespace.

## Stack

- **Runtime**: Bun
- **Agent**: `@anthropic-ai/claude-agent-sdk`
- **TUI**: Ink (React for terminal)
- **IM**: grammY (Telegram)
- **Language**: TypeScript (strict mode)

## CLI Commands

```
oc start      # start daemon (background)
oc stop       # stop daemon
oc restart    # stop + start
oc status     # check if running
oc tui        # connect TUI to running daemon
oc dev        # run daemon in foreground with hot reload
```

## Dev Commands

- `bun run lint` — lint + format check (Biome)
- `bun run lint:fix` — auto-fix lint/format issues
- `bun run typecheck` — TypeScript type check
- `bun run test` — run tests
- `bun run test:watch` — TDD watch mode
- `bun run check` — lint + typecheck + test (full CI check)

## Workflow

**IMPORTANT: This project follows strict TDD (Red-Green-Refactor).**

1. **Red** — Write a failing test first. Do NOT write implementation code without a test.
2. **Green** — Write the minimum implementation to make the test pass.
3. **Refactor** — Clean up while keeping tests green.

Run `bun run check` before considering any work done.

## SDK exploration

When unsure about Claude Agent SDK behavior, write a throwaway script in `dev/`, but convert any settled behavior into automated tests and delete the probe afterward. No API key needed — the SDK uses the Claude Code session auth.

## Conventions

- Use `bun` for all package management and script execution
- Bun auto-loads `.env` — no dotenv needed
- Prefer `Bun.serve()` built-ins (WebSocket, routes) over third-party equivalents
- Tests go in `test/` mirroring `src/` structure (e.g. `src/runtime/agent.ts` → `test/runtime/agent.test.ts`)
- Biome handles linting and formatting (tabs, double quotes)
- All shared types live in `src/common/protocol.ts` — do NOT create re-export shims or barrel files. Import directly from the source module.
- Keep provider-specific logic behind the backend facade. If a change adds a provider SDK import under `src/runtime/`, the design is probably wrong.

## Provider boundaries

- Add provider-specific code under `src/backend/`, not `src/runtime/`.
- When adding new runtime features, define the provider-neutral contract first, then implement the adapter side.
- Runtime stores provider-neutral metadata; raw provider transcript parsing and replay belong in backend adapters.
- Composition in `src/index.ts` may choose a concrete provider for the app, but `createRuntime()` and runtime internals must not default to one.
- Use provider-neutral names in `src/common/` and `src/runtime/`. Avoid provider-colored identifiers when a neutral term exists.
- Do not make runtime tests depend on provider-native message shapes; test those in backend adapter tests.
- Model catalogs, provider capabilities, and provider feature differences belong behind the backend facade, not inside runtime orchestration.
- When migrating persistence, preserve provider ownership explicitly instead of baking in provider names inside runtime code.
- Never resume, replay, switch, or delete a session across a provider mismatch.

## Code organization

**Keep files small and focused.** One responsibility per file. When adding a new feature:

- If it's a new concept (e.g. cron scheduler, memory store), create a new file — don't append to an existing one.
- If a file grows past ~100 lines, look for extraction opportunities.
- Group related files in a directory with `index.ts` as the entry point (e.g. `src/frontend/telegram/`).
- Follow this import direction (arrows = "can import from"):

```
common/  ← backend/  ← runtime/  ← frontend/
                                  ← index.ts / cli.ts
```

`common/` imports nothing. `backend/` imports `common/`. `runtime/` imports `common/` and `backend/`. `frontend/` imports `common/` only. `frontend/` and `backend/` NEVER import from each other.
