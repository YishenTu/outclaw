# Daemon CLI

## Scope

This document owns the local daemon-control surface in `src/cli/daemon.ts`.

It covers:

- daemon lifecycle commands
- first-run onboarding trigger behavior
- daemonless template reseeding before start
- TUI launch behavior gated on daemon state

Runtime architecture and daemon composition stay owned by
`../architecture/system.md` and `../architecture/runtime.md`.

## Commands

```text
oc start
oc stop
oc restart
oc status
oc dev
oc tui [--watch] [--agent <name>]
oc browser
```

## `start`

Current behavior:

- ensures `~/.outclaw/` exists
- exits 1 if the daemon PID is already running
- if no agents exist yet, runs first-agent onboarding interactively
- reseeds any missing workspace templates for existing agents before launch
- spawns `src/index.ts` in the background with stdout/stderr redirected to
  `~/.outclaw/daemon.log`
- writes `daemon.pid`
- waits briefly, then prints either:
  - `Daemon started (pid ...)`
  - or a startup failure message pointing to the log

## `stop`

Current behavior:

- uses the persisted PID file
- removes stale PID files when the target process is already gone
- prints `Daemon is not running` when nothing is active
- prints `Daemon stopped (pid ...)` on success
- exits 1 if the process does not exit within the fixed timeout

## `status`

Current behavior:

- prints `Daemon running (pid ...)` when the persisted PID is live
- otherwise prints `Daemon is not running`
- removes stale PID files opportunistically

## `dev`

Current behavior:

- exits 1 if the daemon is already running
- launches `src/index.ts` in the foreground with `bun --hot`
- inherits stdio directly

This is a foreground development path, not the managed background daemon.

## `tui`

Current behavior:

- requires the daemon to be running; otherwise exits 1 with a start hint
- launches the TUI entrypoint in a child Bun process
- passes `--watch` through to Bun when requested
- passes `--agent <name>` through to the TUI entrypoint when requested
- also accepts explicit agent selection through the higher-level `oc agent <name>`
  shortcut

## `browser`

Current behavior:

- launches the browser frontend development server from
  `src/frontend/browser/`
- does not start the daemon implicitly
- warns if the daemon is not running, but still launches the browser dev server
- forwards any extra CLI args to the underlying `bun run dev` invocation

This keeps the operator model explicit:

- `oc start` means "start the runtime"
- `oc tui` means "open the terminal UI"
- `oc browser` means "open the browser UI"

## `restart`

Current behavior:

- runs `stop`, then `start`
- does not define a separate daemon protocol; it is CLI orchestration of the
  existing commands
