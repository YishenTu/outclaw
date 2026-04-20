# Daemon CLI

## Scope

This document owns the local daemon-control surface in `src/cli/daemon.ts`.

It covers:

- explicit browser build command behavior
- daemon lifecycle commands
- first-run onboarding trigger behavior
- daemonless template reseeding before start
- TUI launch behavior gated on daemon state
- browser dev-server launch behavior alongside the daemon-served built app

Runtime architecture and daemon composition stay owned by
`../architecture/system.md` and `../architecture/runtime.md`.

## Commands

```text
oc build
oc start [--lan] [--host HOST]
oc stop
oc restart [--lan] [--host HOST]
oc status
oc dev
oc tui [--watch] [--agent <name>]
oc browser [vite-args...]
```

## `build`

Current behavior:

- runs `bun run build` in `src/frontend/browser/`
- always rebuilds the browser `dist/` bundle, even if one already exists
- exits with an error if the browser build fails

This is the explicit operator path for rebuilding browser assets after local UI
source changes.

## `start`

Current behavior:

- ensures `~/.outclaw/` exists
- exits 1 if the daemon PID is already running
- accepts at most one host override flag:
  - `--lan` persists `host = 0.0.0.0`
  - `--host HOST` persists the provided bind host
  - combining both is rejected
- if no agents exist yet, runs first-agent onboarding interactively
- reseeds any missing workspace templates for existing agents before launch
- ensures a built browser bundle exists before launch and builds it on demand
  when `src/frontend/browser/dist/index.html` is missing
- clears any persisted shared frontend restart-required notice during daemon boot
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

This is separate from the built browser bundle the daemon serves from `/` after
`oc start`.

This keeps the operator model explicit:

- `oc start` means "start the runtime and serve the built browser bundle"
- `oc build` means "rebuild the browser bundle"
- `oc tui` means "open the terminal UI"
- `oc browser` means "run the browser Vite dev server"

## `restart`

Current behavior:

- runs `stop`, then `start`
- accepts the same `--lan` / `--host HOST` overrides as `start`
- does not define a separate daemon protocol; it is CLI orchestration of the
  existing commands
