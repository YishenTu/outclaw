# Agents

## Identity Model

Each agent has two identifiers:

- **selector name** — the folder basename under `~/.outclaw/agents/<name>/`,
  used by CLI and `/agent`
- **`agent_id`** — the immutable durable owner key stored in `.agent-id`

Persistence is keyed by `agent_id`, not by selector name, prompt contents, or
workspace path strings embedded in prompt files.

## Discovery

`discoverAgents(homeDir)` scans `~/.outclaw/agents/*/.agent-id`, loads each
agent's transport config from the root `config.json`, and returns agents sorted
by selector name.

Discovery rules:

- invalid selector names are rejected at the boundary
- missing `agents/` means "no agents"
- prompt files are not used for discovery

## Workspace Layout

Seeded at agent creation:

```text
~/.outclaw/agents/<name>/
  .agent-id
  AGENTS.md
  SOUL.md
  USER.md
  MEMORY.md
  HEARTBEAT.md
  cron/
  skills/
  .claude/
    skills/ -> ../skills
```

Optional/lazy-created working directories:

- `daily-memories/` — created by agent workflows when they first write daily logs
- `notes/` — optional topic notes created by the user or agent later

`seedTemplates()` owns initial prompt/template seeding. Existing files are not
overwritten on later operations.

## Client Binding

Agent selection is supervisor-owned.

### Interactive Frontends

- TUI and browser runtime sockets may request an initial binding by selector
  name through `agent=<name>`
- plain interactive clients fall back to `last_interactive_agent_id`
- if no remembered value exists, the first discovered agent is used
- when one interactive client switches agents, the supervisor rebinds the other
  connected TUI/browser clients to the same agent so interactive surfaces stay
  in sync

### Telegram

- routing is constrained by `(bot_id, allowedUsers[])`
- remembered routing is stored by `(bot_id, telegram_user_id) -> agent_id`
- if no remembered route exists, the first available agent for that user/token
  is used

Switching agents never mutates one runtime into another. It closes the old
binding and opens the new binding. For TUI/browser that rebind is shared across
connected interactive clients; for Telegram it updates only that user's route.

## Persistence Ownership

Shared SQLite is explicit about agent ownership:

- `sessions`: `(agent_id, provider_id, sdk_session_id)`
- active session state: `active_session_id:{agent_id}:{provider_id}`
- last interactive agent: `last_interactive_agent_id`
- last interactive activity: `last_interactive_at:{agent_id}`
- handled rollover epoch: `last_handled_rollover_interactive_at:{agent_id}`
- rollover notice: `rollover_notice:{agent_id}`
- last user target: `last_user_target:{agent_id}`
- Telegram routing: `(bot_id, telegram_user_id) -> agent_id`
- Telegram file refs: `(bot_id, chat_id, message_id)` plus bot scoping

Provider ownership is stored alongside session identifiers. Session lookup,
resume, transcript reads, and deletion must respect both `agent_id` and
`provider_id`.

## Lifecycle Invariants

Agent management commands are documented in `../cli/agent.md`, but these
invariants are architecture-owned:

- create: generates a new `agent_id`, seeds prompt/templates, and creates the
  Claude skills symlink
- rename: preserves `agent_id`
- remove: deletes the workspace and purges agent-owned persistence/config

Selector names are mutable UX identifiers. `agent_id` is the durable owner key.
