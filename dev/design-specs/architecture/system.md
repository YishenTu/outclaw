# System

## Overview

outclaw is a local multi-agent daemon. One process hosts:

- shared infra under `~/.outclaw/`
- one long-lived runtime per discovered agent workspace
- one supervisor that owns websocket binding, browser HTTP routes, built SPA
  serving, and terminal relay
- one backend facade instance per agent runtime

There is no single mutable "current agent runtime" inside the daemon. Client
switching rebinds a client to another already-created runtime.

Interactive TUI/browser clients share one remembered active-agent selection.
Telegram routing is resolved separately per `(bot_id, telegram_user_id)`.

## Layer Shape

- `src/common/` owns shared protocol types and helpers
- `src/backend/` owns provider behavior, provider transcript parsing, and
  provider workspace setup
- `src/runtime/` owns orchestration, persistence policy, routing, schedulers,
  browser read models, and terminal relay
- `src/frontend/` owns TUI, Telegram, and browser client code plus shared
  websocket client helpers
- `src/cli/` owns local operator commands
- `src/index.ts` is the composition root

## Import Direction

- `src/common/` imports nothing
- `src/backend/` imports `src/common/` only
- `src/runtime/` imports `src/common/` and `src/backend/`
- `src/frontend/` imports `src/common/` only
- `src/cli/` may import `src/common/`, `src/backend/`, and `src/runtime/`
- `src/index.ts` and `src/cli.ts` may compose lower layers, but lower layers
  must not import upward

## Storage Root

Shared infra lives under `~/.outclaw/`:

- `.env`
- `config.json`
- `db.sqlite`
- `daemon.pid`
- `daemon.log`
- `daemon.ready`
- `files/`
- `agents/`

Per-agent workspaces live under `~/.outclaw/agents/<name>/`.

## Durable Boundary Rules

- Runtime must not import provider SDKs directly.
- Runtime must not parse provider-native transcript formats or create
  provider-specific transcript layout.
- Frontends must not import runtime internals or backend adapters; browser uses
  daemon HTTP/WS endpoints instead.
- Shared types must stay in `src/common/protocol.ts`; do not create parallel
  protocol shims.

## Startup Model

`src/index.ts` is responsible for composition, not policy:

1. Load root config.
2. Discover agents from disk.
3. Create shared SQLite-backed stores and per-agent session stores.
4. Create one provider-backed `AgentRuntime` per discovered agent.
5. Create the supervisor websocket server, browser API routes, built browser
   app serving, and terminal relay.
6. Start Telegram bots grouped by token.

The shipped code assumes the multi-agent layout already exists. There is no
runtime-time legacy layout migration path.
