# outclaw

A mini [OpenClaw](https://github.com/openclaw/openclaw) — autonomous AI agent powered by the Claude Agent SDK.

## Architecture

- **Common** — Shared protocol types, commands, model aliases, and serialization helpers
- **Backend** — Facade interface with the Claude Agent SDK adapter (agent invocation, history normalization, skill discovery)
- **Runtime** — WebSocket server, shared active session, provider-scoped SQLite session store, daemon lifecycle, heartbeat scheduler, cron scheduler
- **Frontend** — Ink TUI and Telegram bot connected to the same runtime session

The runtime is provider-neutral orchestration. Provider-specific run semantics,
history lookup/parsing, skill discovery, and provider setup stay behind the
backend facade. Concrete provider selection happens in `src/index.ts`.

## Runtime Layout

```text
src/runtime/
├── application/   # runtime controller, state, message queue
├── commands/      # shared runtime command handling
├── cron/          # cron job scheduler and agent runner
├── heartbeat/     # periodic heartbeat scheduling
├── persistence/   # session store, session manager
├── process/       # daemon PID management
├── prompt/        # system prompt assembly and template seeding
└── transport/     # Bun WS server and client fan-out
```

## Stack

- [Bun](https://bun.sh) — runtime & package manager
- [@anthropic-ai/claude-agent-sdk](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) — agent backend
- [Ink](https://github.com/vadimdemedes/ink) + [ink-multiline-input](https://www.npmjs.com/package/ink-multiline-input) — terminal UI
- [figlet](https://www.npmjs.com/package/figlet) — TUI banner rendering
- [marked](https://www.npmjs.com/package/marked) + [marked-terminal](https://www.npmjs.com/package/marked-terminal) — assistant markdown rendering in the TUI
- [grammY](https://grammy.dev) — Telegram bot
- TypeScript (strict mode)

## Setup

```sh
bun install
bun link
```

Run `oc start` or `oc dev` once to create `~/.outclaw/`. The runtime keeps its own
state and configuration there.

Optional Telegram setup:

- Put Telegram settings in `~/.outclaw/config.json`
- Use literal values or `$ENV_VAR` references for `telegram.botToken`
- Use an array or a `$ENV_VAR` reference for `telegram.allowedUsers`
- Put those referenced env vars in the shell environment or in `~/.outclaw/.env`

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
- `/restart` — restart the daemon

## Runtime State

The daemon stores its state in `~/.outclaw/`:

- `config.json` — normalized runtime config with defaults filled in
- `.env` — optional env file for config values referenced as `$NAME`
- `daemon.pid` — background daemon PID
- `daemon.log` — daemon stdout/stderr from `oc start`
- `db.sqlite` — provider-scoped sessions, active session pointer, Telegram media refs, and last known usage stats
- `cron/` — YAML cron job definitions (one file per job)
- `media/` — copied Telegram media used by the runtime
- `AGENTS.md`, `USER.md`, `SOUL.md`, `MEMORY.md`, `HEARTBEAT.md` — seeded prompt templates

Conversation history is not stored in the runtime database. The runtime persists
provider-scoped metadata and usage, while the backend provider owns the raw
session transcript and history replay source.

State-changing runtime commands are shared across connected frontends. Model changes,
thinking effort changes, session clears, session switches, and session history replay
stay in sync between TUI and Telegram.

The runtime also restores saved usage info when switching sessions, so context usage
survives reconnects and session changes.

## TUI

The TUI renders structured messages with a figlet banner header, git status
display, and random tagline:

- user prompts as highlighted blocks
- assistant thinking as dimmed markdown above the response
- assistant replies as terminal-rendered markdown
- info and error events as separate message types
- a status bar with connection state, model, effort, and context percentage
- an interactive session picker with select, rename, and delete actions

The composer is a multiline editor with terminal-style navigation and editing
shortcuts. Large pastes over 3 lines are collapsed into visible summary tokens and
expanded back to full content only when sent.

## Heartbeat

Periodic internal prompt injected into the active session. The runtime enqueues a
fixed wrapper prompt that tells the agent to read `HEARTBEAT.md`, act only on its
current contents, and reply `HEARTBEAT_OK` when nothing needs attention.
Configurable via `~/.outclaw/config.json`
(`heartbeat.intervalMinutes`, `heartbeat.deferMinutes`).

## Cron Jobs

Parallel agent instances that run independently on a schedule. One YAML file per job
in `~/.outclaw/cron/`. Jobs share the same system prompt and tools as the main
agent. Results are broadcast to all connected frontends and optionally forwarded to
Telegram. The `cron/` directory is watched for live reload without daemon restart.

## License

MIT
