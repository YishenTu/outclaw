---
name: oc
description: Use when operating the `oc` CLI for daemon control, agent management, agent-to-agent communication, past-session lookup, or config security. Also invoke when the user references a past or different session you need to inspect.
---

# oc

Use the `oc` CLI to manage agents, communicate across agents, and inspect past sessions.

## Features

- The user explicitly asks to start, stop, restart, inspect, or connect to the outclaw daemon -> read [references/daemon-operations.md](references/daemon-operations.md)
- The user asks to create, list, rename, or remove an agent, or configure Telegram settings -> read [references/agent-management.md](references/agent-management.md)
- The user asks to contact another agent, delegate work, or ask another agent a question -> read [references/agent-com.md](references/agent-com.md)
- The user asks about past sessions, transcripts, or cron run history -> read [references/session-lookup.md](references/session-lookup.md)
- The user references a past or different session you need to inspect -> read [references/session-lookup.md](references/session-lookup.md)
- The user hardcoded secrets in `config.json` or asks about securing config -> suggest `oc config secure` (moves hardcoded secrets from `config.json` into `.env` variables)

## Gotchas

- Agent create/config/rename/remove take effect on disk immediately, but the running daemon does not hot-reload. A manual `oc restart` is needed afterward.
- `oc session list` defaults to 20 results. Use `--limit N` to see more.
- `oc agent ask` blocks indefinitely unless `--timeout` is passed. On timeout it exits with code 124.

## Response Style

- Be concrete about file paths and commands.
- Prefer exact commands over abstract advice.
