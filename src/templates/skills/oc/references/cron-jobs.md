# Cron Jobs

## When to Use

Reach for this reference when:

- The user asks to **manually run a cron job** (testing a new job, smoke-testing after edits, or rerunning a job that failed earlier).
- The user **references a failed or missed cron run** ("last night's X cron failed", "did the Y job run?").

You can also proactively suggest a smoke-test run after creating or modifying a cron job, instead of waiting for the next scheduled tick.

## Commands

| Command | Purpose |
| --- | --- |
| `oc cron run <cron-name>` | Fire a cron job in the running daemon |
| `oc session list --tag cron` | List recorded cron sessions (most recent first) |
| `oc session transcript <id-or-prefix> --tag cron` | Inspect a cron run transcript |

## Firing a Job

Run `oc cron run <cron-name>` from inside the agent workspace that owns the job. The runtime resolves the agent from the workspace, so jobs with the same name in different agents stay scoped correctly.

**Your job is just to fire it.** The command is silent on accepted execution and exits 0. The cron's output does **not** come back through your shell — it goes through the normal cron delivery path (the same channel a scheduled run would use). Don't wait around for output in the invoking command.

Common failures (these *do* surface in your shell):

- `cannot resolve agent from cwd` — run from an agent workspace.
- `Cron job not found: <name>` — check the `name:` field in the YAML under `cron/`.
- `Cron job is disabled: <name>` — flip `enabled: true` in the YAML before triggering.

## Finding Failed or Past Runs

Cron runs are stored separately from chat sessions. To investigate a failure or check whether a run happened:

1. `oc session list --tag cron` — find the run by timestamp / job name.
2. `oc session transcript <id-or-prefix> --tag cron` — inspect what the cron actually produced (or failed with).

When the user references a failed cron, start here before doing anything else — the transcript usually tells you exactly why it failed (auth error, tool error, no-op reply, etc.), which determines whether a simple rerun will fix it or the root cause needs attention first.
