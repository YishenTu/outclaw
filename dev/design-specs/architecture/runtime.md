# Runtime

## Scope

This document owns the provider-neutral runtime orchestration:

- supervisor-owned client binding and shared interactive agent selection
- one long-lived runtime per agent
- runtime command handling
- session replay and broadcast semantics
- per-agent schedulers

Provider adapter internals belong to `backend.md`.

## Process Model

`src/index.ts` starts one daemon process for `~/.outclaw/`.

Startup flow:

1. Load global config from root `config.json`.
2. Discover agents from `~/.outclaw/agents/*/.agent-id`.
3. Create one provider-backed runtime per discovered agent.
4. Create the supervisor websocket server, browser API routes, built SPA
   serving, and terminal relay.
5. Start Telegram bot instances grouped by shared bot token.

Composition details such as adapter selection and shared-store wiring happen in
`src/index.ts`. Runtime modules consume those dependencies; they do not choose
providers or discover Telegram tokens by themselves.

## Supervisor

`src/runtime/supervisor/`

The supervisor owns cross-agent coordination:

- websocket server lifecycle
- browser HTTP read models, built SPA asset serving, and terminal websocket
  relay
- registry of all agent runtimes
- client-to-agent binding
- short-lived control clients for CLI-driven operations
- `/agent` command handling
- remembered interactive default agent
- Telegram route lookup and updates

The supervisor never mutates one runtime into another. Switching agents only
rebinds a client from one runtime to another.

For interactive clients, the current code keeps TUI and browser aligned on the
same selected agent: switching in one interactive client rebinds the other
connected interactive clients too. Telegram routing remains per bot/user and is
not coupled to that shared interactive selection.

`SupervisorController` intercepts `/agent` before delegating anything to the
bound runtime. `/agent` is therefore supervisor-owned, not runtime-owned.

Control clients are also supervisor-owned. They do not establish an interactive
binding to an agent runtime on connect.

## Agent Runtime

`src/runtime/application/create-agent-runtime.ts`

Each agent runtime owns its own:

- working directory and prompt root
- runtime state and current model/effort
- execution lanes and per-session queues
- session service
- heartbeat scheduler
- cron scheduler
- runtime event broadcast
- prompt-source classification for queued executions

The composition path is:

```text
RuntimeState
  + SessionService
  + RuntimeController
  + HeartbeatScheduler?
  + CronScheduler?
```

Agent runtimes are isolated. Queue state, active session state, replay, and
status are never shared across agent boundaries.

## Parallelism Model

Parallelism is per session lane, not per agent globally.

- each agent runtime may own multiple execution lanes, keyed by session context
- prompts serialize within a single session lane
- different sessions inside one agent runtime may execute at the same time
- different agent runtimes may also execute at the same time
- each agent still exposes exactly one active visible session used for default
  input routing, heartbeat targeting, and `runtime_status`
- inactive sessions may keep running in the background without surfacing live
  output until they become visible again

So the daemon can have multiple agents working in parallel, and each agent can
also have multiple sessions running in parallel, while still preserving
in-session ordering.

## Prompt Sources And Delivery Targets

Runtime execution must distinguish prompt source from user-facing delivery
target.

- prompt source: `tui`, `browser`, `telegram`, `heartbeat`, `agent`
- delivery target: the last user target for that agent, which can be the
  shared interactive target `{ kind: "tui" }` (covering both TUI and browser)
  or a Telegram chat

Browser prompts do travel through the same non-Telegram execution path as TUI,
but the live runtime path keeps them distinguishable as `source="browser"` in
`user_prompt` events. Persistence still collapses accepted browser prompts into
the shared interactive delivery target `{ kind: "tui" }`, and completed
browser-originated chat sessions persist as interactive `source="tui"` session
rows rather than as a separate browser-owned session kind.

Rules:

- accepted TUI / browser / Telegram prompts update `last_user_target`
  immediately on queue acceptance, not on run completion
- agent-originated prompts share the normal queue / prompt-runner path
- agent-originated prompts must not overwrite the last user target for an
  existing session
- heartbeat, cron, and control-only operations must not overwrite the last user
  target
- heartbeat delivery is derived from dedicated delivery-target state, not from
  whichever prompt source ran last

## Command Ownership

### Supervisor-owned

- `/agent`
- initial interactive websocket binding and rebinding
- `ask` request routing for control clients

### Runtime-owned

- `/status`
- `/new`
- `/session ...`
- `/model ...`
- `/<model-alias>`
- `/thinking ...`
- `/stop`
- `/restart`

Session switching is intentionally non-destructive under the current model:

- `/session {id}` switches visibility but does not abort work already running in
  another session lane
- `/stop` aborts only the currently visible session lane
- `/new` and `/session delete ...` abort the visible lane before mutating the
  active-session pointer

### Not a runtime command

`/compact` is a prompt-transport slash command. It must travel through the
normal prompt path so the backend/provider handles compaction inside the active
conversation.

## Routing Semantics

### Interactive Frontends

- TUI and browser share one remembered interactive agent selection
- initial binding may be requested by selector name when the surface supports
  it
- fallback binding uses `last_interactive_agent_id`
- if no remembered value exists, the first agent by selector sort order is used
- when either surface switches agents, the supervisor rebinds the other
  connected interactive clients to the same agent and replays that runtime's
  status/history there too

### Telegram

- startup groups agents by shared token and starts one bot per distinct token
- allowed agents for a user are filtered by `(bot_id, allowedUsers[])`
- current routing is persisted by `(bot_id, telegram_user_id) -> agent_id`
- `/agent {name}` updates only that Telegram route

### Control / CLI

- short-lived CLI operations such as `oc agent ask` connect as `client=control`
- control clients are not rebound to a default agent on connect
- control clients do not emit `agent_switched`, unsolicited `runtime_status`, or
  history replay
- control clients must not mutate `last_interactive_agent_id`

Heartbeat and cron result delivery remain agent-scoped. The runtime remembers
the last user target per agent, not globally.

## Replay And Broadcast

Runtime event fanout is scoped to the bound agent runtime:

- interactive clients receive `runtime_status` immediately on connect
- `runtime_status.running` reflects only whether the currently visible session
  is running, not whether hidden background lanes exist
- successful `/model` changes broadcast a refreshed `runtime_status` after
  `model_changed` so shared context usage reflects the selected model window
- interactive clients receive active-session history replay on connect, after
  session switch, and after agent rebind
- if the visible session is already mid-stream when replay happens, runtime may
  follow `history_replay` with a session-scoped `streaming_sync` catch-up event
  before live chunks resume
- broadcasts go only to clients bound to the same agent runtime
- interactive frontend clients bound to different agents never share
  transcript or runtime status

Control-client request / response flows are opt-in and command-specific. They do
not participate in interactive replay / broadcast behavior.

History replay consumes backend-normalized `DisplayMessage[]`. Runtime does not
parse provider transcripts directly.

## Persistence

Shared infra lives under `~/.outclaw/`:

- `.env`
- `config.json`
- `db.sqlite`
- `files/`
- `agents/`

SQLite is shared, but keys are explicitly scoped:

- sessions: `(agent_id, provider_id, sdk_session_id)`
- transcript search turns: `(agent_id, provider_id, sdk_session_id, turn_index)`
- active session state: `active_session_id:{agent_id}:{provider_id}`
- interactive default agent: `last_interactive_agent_id`
- last interactive activity: `last_interactive_at:{agent_id}`
- handled rollover epoch: `last_handled_rollover_interactive_at:{agent_id}`
- agent-scoped rollover notice: `rollover_notice:{agent_id}`
- shared frontend notice: `frontend_notice`
- Telegram route: `(bot_id, telegram_user_id) -> agent_id`
- last user target: `last_user_target:{agent_id}`
- Telegram file refs: `(bot_id, chat_id, message_id)`

The runtime rejects old incompatible SQLite schemas instead of silently trying
to reinterpret them.

Legacy `last_telegram_delivery:{agent_id}` rows were a one-time operator
migration input only. Current runtime code reads and writes only
`last_user_target:{agent_id}`.

The runtime persists the shared remembered agent under
`last_interactive_agent_id`. Existing `last_tui_agent_id` rows should be
migrated forward on open so TUI and browser continue sharing the same
remembered-agent preference.

The runtime persists both process-global and agent-scoped notice state:

- `frontend_notice` stores process-global frontend notices. Current shipped kind:
  `restart_required`
- `rollover_notice:{agent_id}` stores agent-scoped rollover notices surfaced
  through `runtime_status.notice` as `{ kind: "rollover", message }`

When both exist, the bound agent's rollover notice takes precedence over the
process-global frontend notice. Daemon startup clears the process-global
`restart_required` notice before interactive clients reconnect. Rollover
notices remain persisted until the next accepted interactive prompt for that
agent clears them.

## Transcript Search Index

Session content search is runtime-owned storage infra, not a provider or CLI
concern.

The runtime persists a provider-neutral transcript snapshot in SQLite:

- `transcript_turns` stores searchable turn bodies keyed by
  `(agent_id, provider_id, sdk_session_id, turn_index)`
- `transcript_turns_fts` is an FTS5 external-content index over `body_text`
- only `tag = chat` sessions participate in search indexing

The index body is derived from backend-normalized `readTranscript(sessionId)`
output. Runtime does not parse provider-native transcript files directly.

Write boundary:

- after a completed chat run returns from `facade.run()`
- runtime calls `readTranscript(sessionId)`
- runtime fully replaces that session's indexed transcript rows in one
  transaction

This keeps search crash-safe and deterministic, and it avoids partial per-turn
index writes during streaming.

Indexing rules:

- reply context stays searchable
- image-only placeholders may be omitted from the search index
- exact operational heartbeat boilerplate is excluded from indexing:
  injected heartbeat wrapper prompts and assistant turns that are only
  `HEARTBEAT_OK`
- substantive heartbeat discussion remains searchable

If indexing rules change later, rebuilds should be ad hoc operational work that
reuse the same runtime write path. Do not keep a permanent committed rebuild
script unless that becomes a recurring operator workflow.

## Config Boundary

Root `config.json` is shared infra. It stores:

- runtime globals (`host`, `port`, `autoCompact`, `heartbeat`)
- per-agent transport config under `agents.{agent_id}`

Example:

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

Selector names are used only for UX and env placeholder naming.

Mutation ownership is explicit:

- `oc config runtime` patches runtime globals (`host`, `port`, `autoCompact`,
  `heartbeat`)
- `oc start|restart --lan|--host` own the start-time host override UX and
  persist that `host` value before daemon launch
- `oc agent create|config|remove` own per-agent transport config under
  `agents.{agent_id}`
- `oc config secure` rewrites hardcoded per-agent Telegram values into shared
  `.env` references

Manual file edits are still tolerated on next daemon boot, but restart-required
frontend notices are emitted only for those CLI-driven mutations while the
daemon is running.

## Scheduler Ownership

Each agent runtime may own:

- a `HeartbeatScheduler` for in-session heartbeat prompts
- a `CronScheduler` for independent scheduled runs under that workspace

Those schedulers talk to runtime through internal callbacks. They are not
frontend protocol features.

## Provider Boundary

Runtime code remains provider-neutral:

- it owns scheduling, queueing, session selection, persistence, websocket
  delivery, and prompt assembly
- it does not branch on provider identity
- it does not parse provider-native transcript storage
- it does not create provider-specific filesystem layout beyond explicit backend
  hooks

If runtime needs provider-dependent behavior, the backend facade must grow an
explicit capability rather than adding provider checks inside runtime.
