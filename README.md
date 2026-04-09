# outclaw

A mini [OpenClaw](https://github.com/openclaw/openclaw) — autonomous AI agent powered by the Claude Agent SDK.

## Architecture

- **Runtime** — WS server, shared active session, SQLite session store, history replay, message queue, daemon lifecycle
- **Backend** — Facade interface with Claude Agent SDK adapter
- **Frontend** — Ink TUI and Telegram bot, both connected to the same runtime session
- **Common** — Shared protocol types and helpers

## Runtime Layout

```text
src/runtime/
├── application/   # runtime controller, state, message queue
├── commands/      # shared runtime command handling
├── cron/          # cron job scheduler and agent runner
├── heartbeat/     # periodic heartbeat scheduling
├── persistence/   # session store, session manager, history reader
├── process/       # daemon PID management
├── prompt/        # system prompt assembly and template seeding
└── transport/     # Bun WS server and client fan-out
```

## Stack

- [Bun](https://bun.sh) — runtime & package manager
- [@anthropic-ai/claude-agent-sdk](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) — agent backend
- [Ink](https://github.com/vadimdemedes/ink) — terminal UI
- [grammY](https://grammy.dev) — Telegram bot
- TypeScript (strict mode)

## Setup

```sh
bun install
bun link               # makes 'oc' command available globally
cp .env.example .env   # add TELEGRAM_BOT_TOKEN to enable Telegram
```

## Usage

```sh
oc start     # start daemon (background)
oc restart   # stop + start
oc status    # check if running
oc tui       # connect TUI (--watch for auto-reload)
oc stop      # stop daemon
oc dev       # foreground with hot reload
```

## User Commands

Available from the TUI and Telegram:

- `/new` — start a fresh conversation
- `/model` — show the current model alias
- `/model opus|sonnet|haiku` — switch model
- `/opus`, `/sonnet`, `/haiku` — shorthand model switches
- `/thinking` — show the current effort
- `/thinking low|medium|high|max` — switch effort
- `/session` — open session picker (TUI: interactive menu, Telegram: inline keyboard)
- `/session list` — list recent chat sessions
- `/session <id-prefix>` — switch to a stored session
- `/session delete <id>` — delete a session
- `/session rename <id> <title>` — rename a session
- `/status` — show model, effort, active session, and context usage
- `/stop` — cancel the current agent run

## Runtime State

The daemon stores its state in `~/.outclaw/`:

- `daemon.pid` — background daemon PID
- `daemon.log` — daemon stdout/stderr from `oc start`
- `db.sqlite` — session metadata and active session pointer
- `cron/` — YAML cron job definitions (one file per job)

State-changing runtime commands are shared across connected frontends. Model changes,
thinking effort changes, session clears, session switches, and session history replay
stay in sync between TUI and Telegram.

## Heartbeat

Periodic internal prompt injected into the active session. The runtime enqueues a
fixed wrapper prompt that tells the agent to read `HEARTBEAT.md`, act only on its
current contents, and reply `HEARTBEAT_OK` when nothing needs attention.
Configurable via `config.json` (`heartbeat.intervalMinutes`, `heartbeat.deferMinutes`).

## Cron Jobs

Parallel agent instances that run independently on a schedule. One YAML file per job
in `~/.outclaw/cron/`. Jobs share the same system prompt and tools as the main
agent. Results are broadcast to all connected frontends and optionally forwarded to
Telegram. The `cron/` directory is watched for live reload without daemon restart.

## License

MIT
