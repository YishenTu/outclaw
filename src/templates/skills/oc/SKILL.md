---
name: oc
description: Use when operating the `oc` CLI for daemon control, agent management, agent-to-agent communication, or past-session lookup. Also invoke when the user references a past or different session you need to inspect.
---

# oc

Use the `oc` CLI to manage agents, communicate across agents, and inspect past sessions.

## Features

- The user explicitly asks to start, stop, restart, inspect, or connect to the outclaw daemon -> read [references/daemon-operations.md](references/daemon-operations.md)
- The user asks to create, list, rename, or remove an agent -> read [references/agent-management.md](references/agent-management.md)
- The user asks to contact another agent, delegate work, or ask another agent a question -> read [references/agent-com.md](references/agent-com.md)
- The user asks about past sessions, transcripts, or cron run history -> read [references/session-lookup.md](references/session-lookup.md)
- The user references a past or different session you need to inspect -> read [references/session-lookup.md](references/session-lookup.md)

## Config Security

`oc config secure` moves hardcoded secrets from `config.json` into `.env` variables. Suggest this when the user hardcoded sensitive configs like Telegram tokens in `config.json`.

## Response Style

- Be concrete about file paths and commands.
- Prefer exact commands over abstract advice.
