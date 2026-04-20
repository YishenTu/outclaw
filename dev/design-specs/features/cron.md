# Cron

## Overview

Cron jobs are scheduled background runs owned by a specific agent runtime. They
share that agent workspace's prompt files and tools, but run independently of
the interactive session.

## Job Source

Each agent runtime watches its own `cron/` directory:

```text
~/.outclaw/agents/<name>/cron/*.yaml
```

Only `.yaml` and `.yml` files are considered.

## Job Shape

Current YAML fields:

- `name`
- `schedule`
- `model?`
- `enabled?`
- `telegramUserId?`
- `prompt`

Disabled jobs are removed from the active scheduler without deleting the file.

## Scheduler Behavior

`CronScheduler`:

- loads all enabled jobs on startup
- watches the directory with `fs.watch`
- reloads changed job files in place
- allows overlapping runs if a schedule fires again before a previous run ends

Duplicate job names across files are resolved by last-loaded registration; the
previous file binding is removed.

## Execution

Each fired job:

1. assembles the owning agent's system prompt
2. resolves the configured model alias, or falls back to the runtime's current
   model
3. runs through the backend facade with `stream: false`
4. returns final text plus optional provider session id

Cron runs are independent from the interactive session queue.

## Persistence

Cron runs create normal session rows in shared SQLite, but with `tag: "cron"`.

That is why `oc session list --tag cron` and
`oc session transcript ... --tag cron` can read them without special storage.

## Delivery

If the final text is not `NO_REPLY`:

- broadcast `cron_result` to currently connected clients bound to the same
  agent runtime
- optionally forward the result to a private Telegram chat resolved by cron
  target config

Error runs are delivered as normal cron results prefixed with `[error] ...`.

## Telegram Target Resolution

Cron delivery does not use interactive `last_user_target`.

Instead, it resolves a private Telegram recipient with this precedence:

1. job `telegramUserId`
2. agent `telegram.defaultCronUserId`
3. the single configured allowed user when `allowedUsers.length === 1`
4. otherwise no Telegram cron recipient

Rules:

- the chosen `telegramUserId` must be present in `allowedUsers`
- cron delivery is private-chat only
- for private chats, runtime may treat `chatId = telegramUserId`
- if no Telegram recipient resolves, cron still broadcasts `cron_result` to
  connected runtime clients (for example TUI and browser) but skips Telegram
  delivery
