# Multi-Agent System

## Identity Model

Each agent has two identities:

- **Agent name** — the user-facing selector. This is the folder basename under
  `~/.outclaw/agents/{agent-name}/`. It is used by `oc agent create`,
  `oc tui --agent`, and `/agent {name}`.
- **`agent_id`** — the hidden immutable internal identifier stored in
  `~/.outclaw/agents/{agent-name}/.agent-id`.

`.agent-id` is the only durable owner key. `SOUL.md` and the other prompt files
never participate in discovery or persistence ownership.

## Runtime Shape

One daemon process contains:

- **Supervisor** — owns the shared WebSocket server, Telegram bot manager, and
  per-client current-agent bindings.
- **Agent runtime** — one long-lived runtime per discovered agent. Each runtime
  owns its own `cwd`, prompt root, queue, active session state, heartbeat
  scheduler, cron scheduler, and provider facade integration.
- **Shared infra** — SQLite, `files/`, PID/log handling, and root-level config.

Client switching never mutates one runtime into another. It only rebinds the
client to a different agent runtime.

## Directory Structure

### Top Level

```text
~/.outclaw/
  .env                     # shared env indirection
  config.json              # runtime globals + stored agent transport config
  db.sqlite                # shared agent-scoped persistence
  daemon.pid
  daemon.log
  files/
  agents/
    railly/
    mimi/
```

### Per Agent

```text
agents/{agent-name}/
  .agent-id
  AGENTS.md
  SOUL.md
  USER.md
  MEMORY.md
  HEARTBEAT.md
  notes/
  daily-memories/
  cron/
  skills/
  .claude/
    skills/ -> ../skills
```

## Config Model

Runtime-global config lives at `~/.outclaw/config.json`:

```json
{
  "autoCompact": true,
  "heartbeat": {
    "intervalMinutes": 30,
    "deferMinutes": 0
  },
  "port": 4000,
  "agents": {
    "agent-railly": {
      "telegram": {
        "botToken": "$RAILLY_TELEGRAM_BOT_TOKEN",
        "allowedUsers": "$RAILLY_TELEGRAM_USERS"
      }
    }
  }
}
```

The root `config.json` is shared infra. Agent transport config is stored under
`agents.{agent_id}`. The user-facing selector name is still used to derive env
placeholder names such as `RAILLY_TELEGRAM_BOT_TOKEN`.

## Persistence Scoping

SQLite is shared, but ownership is explicit:

- `sessions` — primary key `(agent_id, provider_id, sdk_session_id)`
- `state` active session key — `active_session_id:{agent_id}:{provider_id}`
- TUI default agent — `last_tui_agent_id`
- last Telegram delivery target — `last_telegram_delivery:{agent_id}`
- Telegram routing — `(bot_id, telegram_user_id) -> agent_id`
- Telegram file refs — `(bot_id, chat_id, message_id)`

Folder names and prompt files are never used as persistence owner keys.

## Agent Switching

`/agent` is available in both TUI and Telegram:

- `/agent` — list available agents and show the current binding
- `/agent {name}` — switch only the current client or current Telegram route

### TUI

- Each WebSocket client has a current `agent_id`.
- `oc tui --agent {name}` selects an initial agent.
- `oc tui` without `--agent` falls back to `last_tui_agent_id`.
- History replay, runtime status, and session menus are scoped to the bound
  runtime.

### Telegram

- The daemon starts one bot per distinct token.
- Candidate agents are filtered by matching token plus `allowedUsers`.
- The current route is stored per `(bot_id, telegram_user_id)`.
- `/agent {name}` updates only that route.
- Heartbeat/cron best-effort delivery uses `last_telegram_delivery:{agent_id}`.

## Onboarding And Agent Management

`oc start` bootstraps the first agent when no agents exist.

Available management commands:

- `oc agent list`
- `oc agent create {name}`
- `oc agent config {name}`
- `oc agent rename {old-name} {new-name}`
- `oc agent remove {name}`
- `oc agent {name}`
- `oc tui --agent {name}`

`oc agent rename` preserves `.agent-id`. Persistent bindings survive rename,
and the seeded `AGENTS.md` workspace path is rewritten to the new selector.

`oc agent remove` deletes the selector directory, drops the stored agent config,
and purges that agent's shared SQLite ownership from sessions, runtime state,
and Telegram routes.

## `oc config secure`

`oc config secure` extracts hardcoded Telegram secrets from root
`config.json` agent entries into `.env` and rewrites them to `$PLACEHOLDER`
references.

Example output:

```text
$ oc config secure
config.json: agents/agent-railly.telegram.botToken -> $RAILLY_TELEGRAM_BOT_TOKEN
config.json: agents/agent-railly.telegram.allowedUsers -> $RAILLY_TELEGRAM_USERS
Updated .env
```

## Self-Manage Skill

Every newly created agent receives the `self-manage` skill. It is the manual
for `oc` and explains:

- daemon operations
- agent creation and management
- session lookup through `oc session`
- Telegram setup through BotFather
- finding a Telegram user ID via `/start`
- working files, sessions, skills, cron, and heartbeat

## Telegram `/start`

The Telegram bot responds to `/start` with the sender's numeric Telegram user
ID. This works before the user is registered with any agent.

## Current Layout Assumption

The shipped runtime assumes the current multi-agent layout already exists on
disk. Runtime startup and persistence no longer contain legacy single-agent
compatibility logic.
