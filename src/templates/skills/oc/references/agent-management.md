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
oc agent create <name> [--bot-token <token>] [--users <telegram-user-id>,...]
```

## Telegram Setup

Walk the user through these steps:

1. Talk to `@BotFather` in Telegram to create a bot and get the bot token.
2. Message the outclaw bot with `/start` — it replies with their numeric Telegram user ID.

Once the user provides both values, pass them via `oc agent create` or `oc agent config`.

## Updating Telegram Config

To add or change Telegram settings on an existing agent:

```bash
oc agent config <name> [--bot-token <token>] [--users <telegram-user-id>,...]
```

Only the flags you pass are updated — omitted fields are preserved.

## Runtime Note

Agent create/config/rename/remove change disk state immediately, but the running daemon does not hot-reload its in-memory agent set. After making one of these changes while the daemon is running, tell the user a manual `oc restart` is needed for the runtime to pick it up.

Do not restart the daemon automatically from inside an ongoing agent flow. Ask the user first so they can choose when to interrupt the current runtime session.
