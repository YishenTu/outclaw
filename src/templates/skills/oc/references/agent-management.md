# Agent Management

## Commands

| Command | Purpose |
| --- | --- |
| `oc agent list` | List all agents |
| `oc agent create <name>` | Create a new agent workspace |
| `oc agent config <name>` | Update an existing agent's settings |
| `oc agent rename <old> <new>` | Rename an agent |
| `oc agent remove <name>` | Remove an agent |

Each agent has its own workspace under `~/.outclaw/agents/<name>/`.

## Creating an Agent

Always use `oc agent create` to create agents. Never create an agent by manually making directories or files — the CLI handles workspace scaffolding, ID generation, and config registration.

When the user asks to create an agent, ask whether they want to connect it to Telegram. If so, walk them through the [Telegram setup](#telegram-setup) steps.

```bash
oc agent create <name> [--bot-token <token>] [--users <telegram-user-id>,...] [--default-cron-user <telegram-user-id>]
```

## Telegram Setup

Walk the user through these steps:

1. Talk to `@BotFather` in Telegram to create a bot and get the bot token.
2. Message the outclaw bot with `/start` — it replies with their numeric Telegram user ID.

Once the user provides both values, pass them via `oc agent create` or `oc agent config`. If multiple users will share the bot, ask which user should receive cron results by default and pass `--default-cron-user`.

## Updating Telegram Config

To add or change Telegram settings on an existing agent:

```bash
oc agent config <name> [--bot-token <token>] [--users <telegram-user-id>,...] [--default-cron-user <telegram-user-id>]
```

Only the flags you pass are updated — omitted fields are preserved.

## Config Schema

Agent settings are stored in `~/.outclaw/config.json` under the `agents` key, keyed by agent ID:

```json
{
  "agents": {
    "<agent-id>": {
      "telegram": {
        "botToken": "<token>",
        "allowedUsers": [123456789],
        "defaultCronUserId": 123456789
      }
    }
  }
}
```

| Field | Type | Description |
| --- | --- | --- |
| `telegram.botToken` | string | Telegram bot token from BotFather |
| `telegram.allowedUsers` | number[] | Telegram user IDs permitted to interact with this agent |
| `telegram.defaultCronUserId` | number (optional) | Default Telegram user to receive cron results |

Any value can be an env-var reference (e.g. `"$MY_BOT_TOKEN"`) — the runtime resolves it from `~/.outclaw/.env` at startup. Use `oc config secure` to migrate hardcoded secrets to env vars. Runtime-global config such as `port`, `autoCompact`, and `heartbeat` is separate and belongs on `oc config runtime`.

## Cron Delivery Routing

Cron job results are delivered to Telegram using this resolution order:

1. Per-job `telegramUserId` (set in the cron job YAML)
2. Agent-level `defaultCronUserId` (set via `--default-cron-user`)
3. Auto-detected: if the agent has exactly one allowed user, that user is used

If none resolve, the cron result is broadcast to connected clients (TUI/WebSocket) but not delivered to Telegram.

Set `--default-cron-user` when the agent has multiple allowed users and you want cron results routed to a specific one without annotating every job. The ID must be in the agent's `allowedUsers` list.

## Runtime Note

Agent create/config/rename/remove change disk state immediately, but the running daemon does not hot-reload its in-memory agent set. After making one of these changes while the daemon is running, tell the user a later `oc restart` is needed for the runtime to pick it up.

These commands now surface a restart-required notice instead of auto-restarting the daemon.

Do not restart the daemon automatically from inside an ongoing agent flow. Ask the user first so they can choose when to interrupt the current runtime session.
