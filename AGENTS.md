# outclaw

A mini OpenClaw: an autonomous agent runtime. The current backend Adapter uses the Claude Agent SDK, while runtime orchestration stays provider-neutral.

## Working Principles

- Slow is fast. Prefer correct, maintainable design over the fastest local patch.
- Prioritize correctness and safety, then explicit requirements, then maintainability and future change, then performance, then brevity.
- Make ownership explicit. Behavior should live where it can be understood, changed, and tested with the least caller knowledge.
- Challenge weak assumptions early. If a requirement is ambiguous or high-impact, align on the design before implementation.
- Fix root causes at the right seam. Do not patch around structural problems with fragile conditionals.

## Architecture

- **Common** (`src/common/`): Shared protocol types, serialization, helpers.
- **Backend** (`src/backend/`): Facade contracts and provider Adapters.
- **Runtime** (`src/runtime/`): Provider-neutral orchestration: WS server, active session, persistence, queues, scheduling, process lifecycle, prompt assembly, and frontend delivery coordination.
- **Frontend** (`src/frontend/`): TUI, browser UI, and Telegram bot connected to the runtime.
- **CLI** (`src/cli.ts`): `oc` command entrypoint.

### Runtime / Provider Seam

`src/runtime/` is provider-neutral orchestration. `src/backend/` owns provider behavior.

- Runtime owns scheduling, queueing, session selection, persistence policy, WS fanout, frontend delivery coordination, and process lifecycle.
- Backend Adapters own run/resume semantics, provider event translation, provider-native history/transcript parsing, capabilities, setup, and provider-specific storage lookup.
- If runtime needs provider-dependent behavior, extend the backend facade with an explicit method or capability. Do not branch on provider identity inside runtime code.
- Runtime must not import provider SDKs, parse provider-native transcript formats, or create provider-specific filesystem layout.
- Persist provider ownership alongside provider session identifiers. Never assume a single global provider namespace, and never resume, replay, switch, or delete across a provider mismatch.
- Composition may choose a concrete provider in `src/index.ts`, but `createRuntime()`, `createAgentRuntime()`, and runtime internals must not default to one.
- Use provider-neutral names in `src/common/` and `src/runtime/`, and keep runtime tests on facade contracts rather than provider-native message shapes.
- Keep all shared protocol types in `src/common/protocol.ts`. Import directly from that source; do not create re-export shims or barrel files for shared types.

Respect this import direction:

```text
common/  <- backend/  <- runtime/  <- frontend/
                                  <- index.ts / cli.ts
```

`common/` imports nothing. `backend/` imports `common/`. `runtime/` imports `common/` and `backend/`. `frontend/` imports `common/` only. `frontend/` and `backend/` never import from each other.

## Design Principles

- Prefer deep modules: small public surface, meaningful behavior hidden inside, and clear ownership of change.
- Use the deletion test before refactoring. Keep a module when removing it would spread complexity across callers; remove or deepen it when it is mostly pass-through indirection.
- Treat the public interface as the test surface. If tests must reach into internals, either test through higher-level behavior or reshape the module.
- Add seams and Adapters only where behavior actually varies. Avoid speculative abstractions for a single implementation.
- Optimize for locality and leverage, not file count. Do not split files only because they are large, and do not preserve tiny helpers that make callers coordinate the real behavior.
- Keep orchestration code near the policy it owns. Avoid scattering one workflow across tiny files unless each file owns a real concept.

## Workflow

This project follows strict TDD: Red, Green, Refactor.

1. **Red**: Write one failing behavior test through the public interface. Do not write implementation code without a test.
2. **Green**: Write the minimum implementation to make that test pass.
3. **Refactor**: Improve structure while keeping tests green.

Use vertical slices: one behavior test, one implementation step, then repeat. Avoid writing a batch of speculative tests before the first implementation. Prefer integration-style tests over implementation-detail tests. Mock only true external seams such as network APIs, time, randomness, filesystem, or process execution.

Run `bun run check` before considering implementation work done.

## Review Expectations

- Findings first. Prioritize correctness bugs, regression risk, API/contract ambiguity, ownership leaks, and missing tests.
- Treat maintainability issues as findings when they increase future change cost or failure risk.
- Call out duplicated logic, tight coupling, unclear ownership, shallow modules, and provider/runtime leaks with a concrete refactoring direction.
- If no material issues are found, say so clearly and mention residual risk or coverage gaps.

## Stack

- **Runtime**: Bun
- **Agent provider**: `@anthropic-ai/claude-agent-sdk`
- **TUI**: Ink / React
- **Browser UI**: React
- **IM**: grammY / Telegram
- **Language**: TypeScript strict mode
- **Formatting/linting**: Biome, tabs, double quotes

## CLI Commands

```text
oc start|restart [--lan] [--host HOST]
oc stop
oc status
oc tui
oc browser
oc dev
oc build
oc onboard
oc agent <list|create|config|rename|remove|ask|name>
oc config <runtime|secure>
oc session <list|search|transcript>
oc cron run <cron-name>
oc note "<content>" [--salience <tag>] [--hint <schema>]
oc schema <status|stale> [--agent <name|id>] [--json]
```

## Dev Commands

- `bun run lint`: lint and format check.
- `bun run lint:fix`: auto-fix lint/format issues.
- `bun run typecheck`: TypeScript type check.
- `bun run test`: run tests.
- `bun run test:watch`: TDD watch mode.
- `bun run check`: lint, typecheck, and test.

## SDK Exploration

When Claude Agent SDK behavior is unclear, write a throwaway probe in `dev/`. Convert settled behavior into automated tests and delete the probe afterward. No API key is needed; the SDK uses the Claude Code session auth.

## Code Organization

Organize code around ownership and depth, not line count. Files should be focused, but a longer deep module is better than many shallow helpers that force callers to coordinate behavior.

- If a change introduces a new concept with its own invariants or lifecycle, give it a named module.
- Extract when it improves locality, hides complexity, or removes duplicated caller knowledge.
- Do not extract just to satisfy a size heuristic; extraction should create a clearer interface.
- Group related modules in a directory with `index.ts` as the entry point when the directory presents a coherent interface.
- Tests go in `test/` mirroring `src/` structure, for example `src/runtime/agent.ts` -> `test/runtime/agent.test.ts`.

## Conventions

- Use `bun` for all package management and script execution.
- Bun auto-loads `.env`; do not add dotenv.
- Prefer `Bun.serve()` built-ins for WebSocket and routes over third-party equivalents.
- Keep provider-specific logic behind the backend facade. If a change adds a provider SDK import under `src/runtime/`, the design is probably wrong.
- Do not add or stage files under `dev/`; treat `dev/` as local scratch/spec space unless the user explicitly asks to track a specific file.
- All code, comments, identifiers, commit messages, and content inside code blocks must be English.
- Explanations and discussions are English by default unless the user writes in another language.
