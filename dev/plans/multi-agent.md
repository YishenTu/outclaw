# Multi-Agent Implementation Status

## Summary

The multi-agent architecture is implemented.

The shipped system uses:

- one supervisor-owned daemon process
- one long-lived runtime per agent
- `.agent-id` as the only durable owner key
- folder basename as the user-facing selector
- root-owned `~/.outclaw/config.json` for runtime globals plus stored
  agent transport config
- shared SQLite with explicit `agent_id` and `bot_id` scoping

## Implemented Areas

### Agent identity and discovery

- runtime discovers agents by scanning `~/.outclaw/agents/*/.agent-id`
- folder name is the selector used by CLI, TUI, and Telegram `/agent`
- rename preserves `.agent-id` and rewrites the seeded `AGENTS.md` workspace
  path to the new selector

### Persistence

- sessions are keyed by `(agent_id, provider_id, sdk_session_id)`
- active session state is keyed by `active_session_id:{agent_id}:{provider_id}`
- TUI default agent is stored in `last_tui_agent_id`
- Telegram routing uses `(bot_id, telegram_user_id) -> agent_id`
- Telegram file refs are scoped by `(bot_id, chat_id, message_id)`
- agent removal purges the removed agent's sessions, runtime state, and
  Telegram routes from shared SQLite

### Runtime and supervisor split

- one WebSocket server per daemon
- one runtime per agent
- per-client current-agent binding in the supervisor
- no cross-agent history or runtime-status leakage

### Frontends

- `oc tui --agent {name}`
- `oc agent {name}` shortcut
- `/agent` and `/agent {name}` in both TUI and Telegram
- one Telegram bot per distinct token
- `/start` returns the sender's Telegram user ID before agent auth

### CLI and onboarding

- `oc agent list`
- `oc agent create {name}`
- `oc agent rename {old} {new}`
- `oc agent remove {name}`
- first-run onboarding through `oc start`

### Operational helpers

- `oc config secure` rewrites hardcoded Telegram values in root `config.json`
  into `.env` placeholder references derived from the agent selector name
- `outclaw-guide` skill is seeded into every created agent

## Deliberate Current Assumptions

- Root `config.json` is shared infra and stores agent transport config under
  `agents.{agent_id}`.
- Runtime startup assumes the multi-agent layout already exists.
- Legacy single-agent compatibility paths have been removed from the shipped code.

## Verification

Current verification target:

- `bun run check`
- smoke startup with `oc start`
- TUI connect with `oc tui --agent {name}`
- Telegram `/start` and `/agent`
