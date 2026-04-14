# Cron Job Feature Design

## Overview

Cron jobs are parallel agent instances owned by a specific agent runtime. They
share that agent's system prompt, tools, and working directory, but run
independently with a task-specific prompt on a schedule.

## Job Configuration

One YAML file per job in `~/.outclaw/agents/<agent-name>/cron/`. Short metadata
fields first, multi-line prompt last.

```yaml
name: daily-summary
schedule: "0 9 * * *"
model: haiku
enabled: true
prompt: |
  Summarize yesterday's activity.
  If nothing noteworthy, reply NO_REPLY.
```

### Fields

| Field    | Required | Default              | Description                          |
|----------|----------|----------------------|--------------------------------------|
| name     | yes      | —                    | Human-readable label                 |
| schedule | yes      | —                    | Cron expression                      |
| model    | no       | main agent's model   | Model alias (from `common/models.ts`)|
| enabled  | no       | true                 | Toggle without deleting the file     |
| prompt   | yes      | —                    | Task-specific user prompt            |

## Scheduler

- On daemon startup, each agent runtime reads all YAML files in its own `cron/`
  directory and registers each enabled job with a cron scheduler (`croner`).
- Watch that agent runtime's `cron/` directory with `fs.watch` — on file
  add/change/remove, reload the affected job and update its schedule.
- When a job's schedule fires, spawn a parallel agent instance.
- Concurrency: no restrictions. If a job is still running when the next tick fires, a new instance spawns. Overlap is unlikely given typical schedules but allowed.

## Agent Lifecycle

- Each cron run spawns a new agent through the backend facade
  (provider-agnostic), with the same settings (system prompt, tools, cwd) as
  the owning agent runtime.
- The job's `prompt` is sent as the user message.
- The agent's `model` is resolved via `resolveModelAlias()` from `common/models.ts`, falling back to the main agent's current model if not specified.
- The agent runs through the shared facade with `stream: false`. The adapter emits a single synthesized `text` event from the final assistant message, followed by `done`.

## Output

- The final response is broadcast to all connected frontends bound to that same
  agent runtime as a `CronResultEvent`
  (`type: "cron_result"`, `jobName`, `text`).
- If the final response text trims to `NO_REPLY` (case-insensitive), the result is suppressed entirely — no broadcast, no Telegram delivery.
- If the agent runtime has a remembered Telegram chat ID, the result is
  additionally delivered there (formatted as `[cron] {jobName}\n{text}`, sent
  silently). Current implementation keys this off
  `last_telegram_delivery:{agent_id}`, not the current active frontend surface.

## Session Store

- Each cron run creates a session in the shared SQLite session store, scoped to
  the owning `agent_id` plus the current provider ID.
- Sessions are tagged with `tag: "cron"` to distinguish cron runs from main agent conversations (`tag: "chat"`).

## Error Handling

- If a cron agent errors out, the scheduler emits a normal cron result with text prefixed by `[error] ...`.
- That error result is broadcast and may also be forwarded to Telegram through the same cron delivery path.
