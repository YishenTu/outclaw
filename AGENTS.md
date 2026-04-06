# misanthropic

A mini OpenClaw: autonomous AI agent powered by the Claude Agent SDK.

## Architecture

- **Runtime** (`src/runtime/`): Orchestrates agent lifecycle, sessions, and message routing
- **Backend** (`src/backend/`): HTTP/WebSocket server exposing the runtime
- **Frontend** (`src/frontend/`): Optional browser UI and TUI
- **Tools** (`src/tools/`): Custom MCP tools available to the agent

## Stack

- **Runtime**: Bun
- **Agent**: `@anthropic-ai/claude-agent-sdk`
- **HTTP**: Hono (or `Bun.serve()` directly)
- **Validation**: Zod
- **Language**: TypeScript (strict mode)

## Commands

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

When unsure about Claude Agent SDK behavior, write a throwaway script in `dev/` to test it (e.g. `bun dev/test-query.ts`). No API key needed — the SDK uses the Claude Code session auth.

## Conventions

- Use `bun` for all package management and script execution
- Bun auto-loads `.env` — no dotenv needed
- Prefer `Bun.serve()` built-ins (WebSocket, routes) over third-party equivalents
- Tests go in `test/` mirroring `src/` structure (e.g. `src/runtime/agent.ts` → `test/runtime/agent.test.ts`)
- Biome handles linting and formatting (tabs, double quotes)
- All shared types live in `src/common/protocol.ts` — do NOT create re-export shims or barrel files. Import directly from the source module.

## Code organization

**Keep files small and focused.** One responsibility per file. When adding a new feature:

- If it's a new concept (e.g. cron scheduler, memory store), create a new file — don't append to an existing one.
- If a file grows past ~100 lines, look for extraction opportunities.
- Group related files in a directory with `index.ts` as the entry point (e.g. `src/frontend/telegram/`).
- Follow this import direction (arrows = "can import from"):

```
common/  ← backend/  ← runtime/  ← frontend/
                                  ← index.ts
```

`common/` imports nothing. `backend/` imports `common/`. `runtime/` imports `common/` and `backend/`. `frontend/` imports `common/` only. `frontend/` and `backend/` NEVER import from each other.

