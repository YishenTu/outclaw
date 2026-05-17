# outclaw

A mini OpenClaw: a multi-agent autonomous runtime. Backend adapters currently support the Claude Agent SDK and Codex app-server, while runtime orchestration stays provider-neutral.

## Working Principles

- Slow is fast. Prefer correct, maintainable design over the fastest local patch.
- Prioritize correctness and safety, then explicit requirements, then maintainability and future change, then performance, then brevity.
- Make ownership explicit. Behavior should live where it can be understood, changed, and tested with the least caller knowledge.
- Challenge weak assumptions early. If a requirement is ambiguous or high-impact, align on the design before implementation.
- Fix root causes at the right seam. Do not patch around structural problems with fragile conditionals.

## Architecture

- **Common** (`src/common/`): Shared protocol types, facade contracts, serialization, and helpers.
- **Backend** (`src/backend/`): Provider adapters behind the facade, currently Claude Agent SDK and Codex app-server.
- **Runtime** (`src/runtime/`): Provider-neutral orchestration: supervisor, transport, agent runtime state, session persistence, queues, scheduling, process lifecycle, prompt assembly, browser APIs, coding-session bookkeeping, memory watchers, and frontend delivery coordination.
- **Frontend** (`src/frontend/`): TUI, browser UI, Telegram bot, and runtime client code connected through the shared protocol.
- **CLI** (`src/cli.ts`, `src/cli/`): `oc` command entrypoint and command implementations for daemon/control-plane operations.

### Runtime / Provider Seam

`src/runtime/` is provider-neutral orchestration. `src/backend/` owns provider behavior.

- Runtime owns scheduling, queueing, session selection, persistence policy, WS/HTTP fanout, browser APIs, frontend delivery coordination, process lifecycle, and provider-neutral coding repository/session bookkeeping.
- Backend adapters own run/resume/steer semantics, provider event translation, provider-native history/transcript parsing, model and skill capability lookup, workspace setup, and provider-specific storage lookup.
- If runtime needs provider-dependent behavior, extend the facade in `src/common/protocol.ts` with an explicit method or capability. Do not branch on concrete provider identity inside runtime code.
- Runtime must not import provider SDKs, import backend adapter internals, parse provider-native transcript formats, or create provider-specific filesystem layout.
- Persist provider ownership alongside provider session identifiers. Never assume a single global provider namespace, and never resume, replay, switch, or delete across a provider mismatch.
- Composition in `src/index.ts` wires concrete providers and may choose defaults. `createAgentRuntime()` and runtime internals receive providers through facade contracts and must stay provider-neutral.
- CLI and onboarding code may call provider setup APIs at the entrypoint boundary, but provider-specific behavior should stay delegated to backend adapters or setup helpers.
- Use provider-neutral names in `src/common/` and `src/runtime/`, and keep runtime tests on facade contracts rather than provider-native message shapes.
- Keep all shared protocol types in `src/common/protocol.ts`. Import directly from that source; do not create re-export shims or barrel files for shared types.

Respect these import boundaries:

- `common/` imports no project layers.
- `backend/` imports `common/` only.
- `runtime/` imports `common/` only; it talks to providers through facade values supplied by composition.
- `frontend/` imports `common/` only.
- `src/index.ts` and `src/cli/**` are entrypoint/composition boundaries. Keep cross-layer wiring there and keep provider-specific behavior behind backend adapters/setup helpers.

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
- **Agent providers**: Claude Agent SDK and Codex app-server
- **Coding provider**: Codex app-server
- **TUI**: Ink / React
- **Browser UI**: React / Vite / Tailwind
- **IM**: grammY / Telegram
- **Language**: TypeScript strict mode
- **Formatting/linting**: Biome, tabs, double quotes

## Dev Commands

- `bun run lint`: lint and format check.
- `bun run lint:fix`: auto-fix lint/format issues.
- `bun run typecheck`: TypeScript type check.
- `bun run test`: run tests.
- `bun run test:watch`: TDD watch mode.
- `bun run check`: lint, typecheck, and test.

## Provider Exploration

When Claude Agent SDK or Codex app-server behavior is unclear, write a throwaway probe in `dev/`. Convert settled behavior into automated tests and delete the probe afterward. No API key is needed for Claude SDK probes; the SDK uses Claude Code session auth.

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
