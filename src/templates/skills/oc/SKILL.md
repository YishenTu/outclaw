---
name: oc
description: Use when operating the `oc` CLI for daemon control, agent management, config updates, agent-to-agent communication, or past-session lookup. Also invoke when the user references a past or different session you need to inspect.
---

# oc

Use the `oc` CLI to manage agents, control the daemon, rebuild the browser bundle, communicate across agents, and inspect past sessions.

## Quick Start

- First run: `oc build && oc start`
- Command help: `oc <command> -h`
- After browser source changes: `oc build && oc restart`

## Features

- The user explicitly asks to start, stop, restart, rebuild, inspect, or connect to the outclaw daemon -> read [references/daemon-operations.md](references/daemon-operations.md)
- The user asks to create, list, rename, or remove an agent, or configure Telegram settings -> read [references/agent-management.md](references/agent-management.md)
- The user asks to change runtime-global config (`host`, `port`, `autoCompact`, heartbeat) or secure hardcoded config -> read [references/config-management.md](references/config-management.md)
- The user asks to contact another agent, delegate work, or ask another agent a question -> read [references/agent-com.md](references/agent-com.md)
- The user asks about past sessions, transcripts, or cron run history -> read [references/session-lookup.md](references/session-lookup.md)
- The user references a past or different session you need to inspect -> read [references/session-lookup.md](references/session-lookup.md)

## Gotchas

- `oc agent create|config|rename|remove`, `oc config runtime`, and `oc config secure` mutate files immediately, but the running daemon does not hot-reload them. They surface a restart-required notice; a later `oc restart` is still needed to apply them.
- `oc start` auto-builds the browser bundle only when it is missing. If browser source changed and needs a fresh production bundle, use `oc build` and then `oc restart`.
- `oc start` and `oc restart` default to `host: "127.0.0.1"`. Use `--lan` to persist `host: "0.0.0.0"` when browser access from another machine is required.
- `oc session list` defaults to 20 results. Use `--limit N` to see more.
- `oc agent ask` blocks indefinitely unless `--timeout` is passed. On timeout it exits with code 124.

## Response Style

- Be concrete about file paths and commands.
- Prefer exact commands over abstract advice.
