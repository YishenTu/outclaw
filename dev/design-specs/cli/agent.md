# Agent CLI

## Scope

This document owns the local `oc agent ...` surface in `src/cli/agent.ts`.

Architecture-level identity and persistence invariants stay in
`../architecture/agents.md`.

## Commands

```text
oc agent list
oc agent create <name> [--bot-token <token>] [--users <ids>] [--default-cron-user <id>]
oc agent rename <old-name> <new-name>
oc agent remove <name>
oc agent config <name> [--bot-token <token>] [--users <ids>] [--default-cron-user <id>]
oc agent ask --to <name> [--timeout <seconds>] "<message>"
oc agent <name>
```

## Behavior

### `oc agent list`

- reads discovered agents from disk
- prints selector names only

### `oc agent create`

- validates the selector name
- creates `~/.outclaw/agents/<name>/`
- writes `.agent-id`
- seeds templates into the workspace
- creates `.claude/skills -> ../skills`
- writes per-agent Telegram config into root `config.json`
- ensures root `.env` exists

This command is daemonless.

### `oc agent rename`

- renames the workspace directory
- preserves `.agent-id`
- rewrites seeded workspace path references inside `AGENTS.md`

### `oc agent remove`

- deletes the workspace directory
- deletes stored agent transport config from root `config.json`
- purges agent-owned session data and Telegram routes from shared SQLite

### `oc agent config`

- updates stored Telegram config for an existing agent
- optionally sets the per-agent default private Telegram user for cron delivery
- does not mutate prompt files

## Restart-Required Behavior

`oc agent create`, `rename`, `remove`, and `config` mutate files the running
daemon does not hot-reload:

- agent discovery under `~/.outclaw/agents/*`
- per-agent transport config in root `config.json`

So current behavior is:

- if the daemon is not running, these commands are pure filesystem / SQLite
  mutations
- if the daemon is running, they still do not restart it automatically
- instead they set the shared frontend `restart_required` notice and print a
  restart-required message

### `oc agent ask`

- requires a running daemon
- requires execution from inside an agent workspace containing `.agent-id`
- resolves the sender from workspace identity, not from a CLI flag
- connects to the supervisor as a short-lived control client
- resolves the target by selector name
- prints the target agent's final text response to stdout
- waits indefinitely unless `--timeout` is passed
- exits 124 only when an explicit timeout expires

This command is daemon-backed. It is not a TUI alias and does not establish an
interactive client binding.

### `oc agent <name>`

Any unknown `oc agent <subcommand>` token falls through to the TUI launcher and
behaves like `oc tui --agent <name>`.

This is a UX shortcut, not a new agent-management operation.

## Boundary Rules

- command parsing lives in `src/cli/agent.ts`
- workspace creation/removal/rename lives in `src/runtime/agents/`
- template seeding and config writes are delegated to dedicated modules
- control-client ask routing lives outside `src/cli/`

The CLI owns UX and orchestration of those operations. The underlying mutation
logic should stay out of `src/cli/`.
