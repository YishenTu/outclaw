# Cron Jobs

## When to Use

Reach for this reference when:

- The user asks to **manually run a cron job** (testing a new job, smoke-testing after edits, or rerunning a job that failed earlier).
- The user **references a failed or missed cron run** ("last night's X cron failed", "did the Y job run?").

You can also proactively suggest a smoke-test run after creating or modifying a cron job, instead of waiting for the next scheduled tick.

## Schedule Forms

Cron YAML supports exactly one schedule field:

- `schedule: "0 9 * * 1"` for recurring cron expressions.
- `runAt: "2026-04-29T09:00:00+08:00"` for a one-time run.

One-time `runAt` values must be ISO 8601 datetimes with explicit `Z` or numeric offset. Do not add `timezone` to a `runAt` job; offsets belong inside the `runAt` value. After a scheduled one-time job starts, Outclaw rewrites the YAML with `enabled: false`. A manual `oc cron run <cron-name>` does not consume or disable a one-time job.

## Commands

| Command | Purpose |
| --- | --- |
| `oc cron run <cron-name>` | Fire a cron job in the running daemon |
| `oc cron status --failed [--since DURATION\|DATE] [--limit N] [--job NAME] [--names] [--json]` | List failed cron runs |
| `oc session list --tag cron` | List recorded cron sessions (most recent first) |
| `oc session transcript <id-or-prefix> --tag cron` | Inspect a cron run transcript |

## Firing a Job

Run `oc cron run <cron-name>` from inside the agent workspace that owns the job. The runtime resolves the agent from the workspace, so jobs with the same name in different agents stay scoped correctly.

**Your job is just to fire it.** The command is silent on accepted execution and exits 0. The cron's output does **not** come back through your shell — it goes through the normal cron delivery path (the same channel a scheduled run would use). Don't wait around for output in the invoking command.

Common failures (these *do* surface in your shell):

- `cannot resolve agent from cwd` — run from an agent workspace.
- `Cron job not found: <name>` — check the `name:` field in the YAML under `cron/`.
- `Cron job is disabled: <name>` — flip `enabled: true` in the YAML before triggering.

## Finding Failed Runs

`oc cron status --failed` shows recent failed runs for the current agent (default window: 7d). Modifiers:

- `--since 24h` — narrow to a recent window (any duration or ISO date).
- `--job <name>` — restrict to one job.
- `--names` — print only job names, suitable for piping into `oc cron run`.

Use `oc session transcript <id-or-prefix> --tag cron` when the failure summary isn't enough to decide what to do next.

## Finding Past Runs

Use `oc session list --tag cron` to browse past cron runs by timestamp and job name. Use `oc session transcript <id-or-prefix> --tag cron` when you need the run output.
