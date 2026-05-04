---
name: oc
description: Use when operating the `oc` CLI for daemon control, agent management, config updates, agent-to-agent communication, cron job operations and failure inspection, past-session lookup, memory capture (`oc note`), or schema-memory freshness checks (`oc schema`). Also invoke when the user references a past or different session you need to inspect.
---

# oc

Use the `oc` CLI to manage agents, control the daemon, rebuild the browser bundle, communicate across agents, inspect past sessions, and work with agent memory.

## Quick Start

- Command help: `oc <command> -h`

## Routing

- When the user asks to start, stop, restart, rebuild, inspect, or connect to the outclaw daemon → [references/daemon-operations.md](references/daemon-operations.md)
- When the user asks to create, list, rename, or remove an agent, or configure Telegram settings → [references/agent-management.md](references/agent-management.md)
- When the user asks to change runtime-global config (`host`, `port`, `autoCompact`, heartbeat, `thinkingEffort`) or secure hardcoded config → [references/config-management.md](references/config-management.md)
- When the user asks to contact another agent, delegate work, or ask another agent a question → [references/agent-com.md](references/agent-com.md)
- When the user asks to manually trigger, test, rerun, or inspect failures of a cron job → [references/cron-jobs.md](references/cron-jobs.md)
- When the user asks about past sessions or transcripts, or references a past or different session you need to inspect → [references/session-lookup.md](references/session-lookup.md)
- When you need to capture an observation to memory (the `oc note` write primitive for daily memory) → [references/memory-capture.md](references/memory-capture.md)
- When you need to check whether schema Models are behind their Observations, or identify schemas needing synthesis attention → [references/schema-memory.md](references/schema-memory.md)

## Gotchas

- `oc agent create|config|rename|remove`, `oc config runtime`, and `oc config secure` mutate files immediately, but the running daemon does not hot-reload them. They surface a restart-required notice; a later `oc restart` is still needed to apply them.

## Response Style

- Be concrete about file paths and commands.
- Prefer exact commands over abstract advice.
