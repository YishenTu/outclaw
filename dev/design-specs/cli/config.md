# Config CLI

## Scope

This document owns the local `oc config ...` surface in `src/cli/config.ts`.

The shipped surface is intentionally explicit. It covers restart-bound runtime
globals and secret-hygiene rewrites. It is not a generic config editor.

## Commands

```text
oc config runtime [--host HOST] [--port N] [--auto-compact true|false] [--heartbeat-interval N] [--heartbeat-defer N]
oc config secure
```

## `runtime`

`oc config runtime` patches the runtime-global portion of
`~/.outclaw/config.json`.

Supported flags:

- `--host <HOST>`
- `--port <N>`
- `--auto-compact true|false`
- `--heartbeat-interval <N>`
- `--heartbeat-defer <N>`

Current behavior:

- requires at least one supported flag
- validates booleans explicitly as `true` or `false`
- validates numeric fields as non-negative integers
- allows `--port 0` for ephemeral-port development workflows
- creates `~/.outclaw/config.json` when it does not exist yet
- merges provided values over normalized defaults
- preserves unknown top-level keys and per-agent config under `agents`
- prints `Configured runtime settings` on success

Runtime mutation boundary:

- this command owns only runtime globals: `host`, `port`, `autoCompact`, and
  `heartbeat`
- per-agent transport config remains owned by `oc agent ...` and
  `oc config secure`
- this command does not generalize into arbitrary JSON-path writes

Restart behavior:

- if the daemon is not running, this is a pure file mutation
- if the daemon is running, the command still does not restart it
- instead it sets the shared frontend `restart_required` notice in SQLite and
  prints `Restart required...`

## `secure`

`oc config secure` extracts hardcoded per-agent Telegram config from the shared
root `config.json` into `.env` entries.

Current behavior:

- scans discovered agents
- reads each agent's stored Telegram config from root `config.json`
- rewrites hardcoded `telegram.botToken` values to selector-derived env refs
- rewrites hardcoded `telegram.allowedUsers` values to selector-derived env refs
- writes or updates shared `.env` entries
- leaves already-env-backed values unchanged

Output behavior:

- prints one `config.json: ... -> $ENV_KEY` line per rewritten field
- prints `Updated .env` when any change was made
- prints `No hardcoded agent telegram config found in config.json` when nothing
  needed rewriting
- if the daemon is running and any rewrite happened, it also sets the shared
  frontend `restart_required` notice instead of auto-restarting the daemon

## Boundary Rules

- command parsing lives in `src/cli/config.ts`
- runtime-global config normalization and writes live in `src/runtime/config.ts`
- the rewrite logic lives in `src/runtime/config/secure-agent-config.ts`
- restart-required notice emission lives in `src/cli/restart-required.ts`
- this command surface stays explicit; do not grow a generic mutable config
  editor or filesystem watcher around `config.json`
