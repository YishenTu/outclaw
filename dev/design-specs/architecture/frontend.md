# Frontend

## Scope

This document owns the shared frontend contract only:

- runtime websocket client helpers shared by TUI, Telegram, and browser
- shared binding/query semantics
- the boundary between transport helpers and surface-specific UI logic

It does not own runtime orchestration, persistence, or provider behavior.

Short-lived CLI control clients such as `oc agent ask` are out of scope here.
They talk to the same supervisor, but they are not frontend surfaces and do not
participate in the shared interactive-client contract below.

## Design Principles

Frontends are thin I/O adapters. They render runtime state, capture user input,
and keep only local UI state.

Business state lives in the daemon:

- current session per agent runtime
- session history and runtime status
- current interactive agent selection shared by TUI/browser clients
- Telegram user-to-agent routing
- frontend notices such as process-global `restart_required` and agent-scoped
  `rollover`

## Shared Transport

`src/frontend/runtime-client/index.ts`

Shared helpers:

- `buildRuntimeSocketUrl(url, clientType, agentName?, options?)`
- `openRuntimeSocket(url, clientType, agentName?, options?)`
- `sendRuntimePrompt(...)`
- `sendRuntimeCommand(...)`
- `sendRequestSkills(...)`

The transport layer stays narrow and provider-neutral. It carries:

- client type (`tui`, `telegram`, or `browser`)
- optional initial agent selector
- optional Telegram routing context (`telegramBotId`, `telegramUserId`)
- prompt payloads in the shared `prompt + images[] + replyContext` shape

The runtime resolves those inputs into a bound agent runtime. Frontends do not
perform agent discovery or persistence locally.

## Agent Binding Semantics

The daemon does not expose one global active runtime. Each connected client is
bound to exactly one agent runtime at a time.

- TUI can request an initial binding with `oc tui --agent {name}`.
- browser runtime sockets may also request `agent={name}` when needed, though
  normal browser UX uses the shared remembered agent plus daemon HTTP summaries.
- plain interactive clients without an explicit selector fall back to persisted
  `last_interactive_agent_id`.
- when either TUI or browser switches agents, the supervisor rebinds the other
  connected interactive clients so both surfaces stay on the same active agent.
- Telegram connections include bot/user routing context.
- `/agent` shows only the agents available to that client.
- `/agent {name}` switches only the current Telegram route, but switches the
  shared interactive binding for TUI/browser.

Broadcast semantics are therefore agent-scoped:

- clients bound to the same agent runtime see the same runtime-status and
  session-level events
- clients bound to different agents do not share transcript, session, or
  status state

Browser is therefore both:

- a distinct websocket client type (`client=browser`)
- a distinct live prompt source for runtime `user_prompt` events

But it still shares the interactive remembered-agent preference and persisted
`{ kind: "tui" }` delivery-target semantics with TUI. The daemon does not
create a separate browser-only delivery target or stored session-owner kind.

## Shared Event Expectations

The current shared contract expects:

- `runtime_status` immediately after connect for interactive frontend clients
- `runtime_status.running` to describe only the currently visible session for
  that client binding
- successful `/model` changes to be followed by a fresh `runtime_status` so
  frontends can refresh context usage without reconnecting
- `runtime_status.notice` for frontend notices when present
- `history_replay` after connect and after session switch for interactive
  frontend clients
- a replayed session that is already mid-stream may also receive a follow-up
  `streaming_sync` event before new live chunks arrive
- runtime command replies via the normal event stream
- prompt output via `thinking`, `text`, `image`, `done`, and compaction events

Surface-specific rendering belongs elsewhere. This document owns only the shared
transport-level expectations.

Current shipped notice kinds:

- `restart_required` — tells interactive clients that daemon restart-bound
  config or agent discovery changes are pending
- `rollover` — tells interactive clients that the bound agent auto-finalized
  its previously active session after idle timeout

## TUI Boundary

`src/frontend/tui/`

The TUI owns terminal-specific behavior:

- multiline composition and slash-command entry
- transcript rendering
- inline session picker
- inline agent picker
- reconnect handling and local optimistic prompt rendering

The TUI stays provider-neutral and talks only to the shared runtime protocol.

## Telegram Boundary

`src/frontend/telegram/`

Telegram owns chat-specific behavior:

- command registration and formatting
- per-message websocket bridging
- reply-context extraction
- file upload/download handling
- Telegram-native streaming delivery

Multiple agents may share one Telegram bot token. Frontend-side bot startup is
therefore grouped by token, while runtime routing stays agent-scoped.

## Browser Boundary

`src/frontend/browser/`

Browser owns browser-specific behavior:

- tabbed chat + file-preview shell
- sidebar rendering for cross-agent session summaries
- browser-local view state such as open tabs, scroll position, layout, and
  agent ordering
- HTTP read models for sidebar, file tree, cron, git, diff, and terminal
  routes

The browser stays provider-neutral. It uses the shared websocket transport for
the currently bound agent runtime and daemon-owned HTTP endpoints for read-only
cross-agent summaries. It must not read SQLite directly from browser code.

The browser is not a separate delivery model like Telegram. It is an alternate
rendering of the same interactive bound-agent event stream used by TUI, with
browser-specific navigation and inspection panels around that transcript.

## Ownership Map

- shared websocket helper API -> this document
- daemon routing, runtime binding, persistence -> `runtime.md`
- agent identity and persistence ownership -> `agents.md`
- TUI module structure and UX -> `../frontend/tui.md`
- Telegram module structure and delivery flow -> `../frontend/telegram.md`
- Browser module structure and UX -> `../frontend/browser.md`
