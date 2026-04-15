# Session Lookup

## Commands

| Command | Purpose |
| --- | --- |
| `oc session list` | List chat sessions (scoped to current agent when run from an agent workspace) |
| `oc session list --tag cron` | List cron sessions |
| `oc session transcript <id-or-prefix>` | Print a past conversation transcript with timestamps |
| `oc session transcript <id-or-prefix> --tag cron` | Read a cron session transcript |

## Guidance

- If the user references a past or different session and you need to inspect it, use `oc session` rather than guessing from memory.
- The `id` shown by `oc session list` is a readable prefix of the full durable session ID.
- If `oc session transcript <id-or-prefix>` reports multiple matches, rerun with a longer prefix or the full ID.
- Cron runs are stored separately with `tag = cron` and are not normal chat sessions.
