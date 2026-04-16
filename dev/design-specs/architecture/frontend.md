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
- current agent binding for each connected client
- Telegram user-to-agent routing

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
- Plain interactive clients without an explicit selector fall back to persisted
  `last_interactive_agent_id`.
- Telegram connections include bot/user routing context.
- `/agent` shows only the agents available to that client.
- `/agent {name}` switches only the current client binding.

Broadcast semantics are therefore agent-scoped:

- clients bound to the same agent runtime see the same runtime-status and
  session-level events
- clients bound to different agents do not share transcript, session, or
  status state

## Shared Event Expectations

The current shared contract expects:

- `runtime_status` immediately after connect for interactive frontend clients
- `history_replay` after connect and after session switch for interactive
  frontend clients
- runtime command replies via the normal event stream
- prompt output via `thinking`, `text`, `image`, `done`, and compaction events

Surface-specific rendering belongs elsewhere. This document owns only the shared
transport-level expectations.

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
