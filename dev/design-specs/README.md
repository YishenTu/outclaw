# Design Specs

Specs are organized by ownership boundary, not by implementation order.

## Layout

- `architecture/` — durable system boundaries and invariants
- `cli/` — `oc` command surfaces and process-level command orchestration
- `frontend/` — surface-specific TUI, Telegram, and browser behavior
- `features/` — cross-layer behaviors that span multiple boundaries
- `roadmap.md` — lightweight backlog / progress tracker, not a source of truth

## Boundary Rules

- `architecture/*.md` own structural contracts: identity, layering, storage,
  routing, provider boundaries, prompt assembly.
- `cli/*.md` own local command UX, daemon control, and command-side read/write
  behavior under `src/cli/`.
- `frontend/*.md` own only surface-specific rendering, controls, and transport
  usage. They do not redefine runtime semantics.
- `features/*.md` own behaviors that necessarily cut across backend, runtime,
  and frontend boundaries, such as compaction.
- `roadmap.md` is backlog only and may track rough progress, but it is never the
  source of truth for shipped behavior.

## Ownership Heuristics

- If the rule is enforced by a layer boundary or persistence invariant, it
  belongs in `architecture/`.
- If the rule is about a concrete operator command, it belongs in `cli/`.
- If the rule is about how one frontend renders or captures input, it belongs in
  `frontend/`.
- If the rule spans multiple layers and needs end-to-end sequencing, it belongs
  in `features/`.

## Current Map

### Architecture

- `architecture/system.md` — top-level daemon shape, storage root, and import
  direction
- `architecture/agents.md` — agent identity, discovery, routing, and
  persistence ownership
- `architecture/backend.md` — provider facade contract and Claude adapter
  responsibilities
- `architecture/runtime.md` — supervisor/runtime split and runtime command
  ownership, shared persistence, and transcript-search indexing
- `architecture/frontend.md` — shared websocket client contract used by TUI,
  Telegram, and browser
- `architecture/prompting.md` — prompt file assembly, templates, and workspace
  conventions

### CLI

- `cli/daemon.md` — `oc start|stop|restart|status|dev|tui|browser` lifecycle
  and side effects
- `cli/agent.md` — `oc agent ...` lifecycle and side effects
- `cli/config.md` — `oc config secure` config-to-env extraction behavior
- `cli/session.md` — shipped `oc session ...` operator surface: list, search, transcript, and scoping

### Frontend

- `frontend/tui.md` — TUI composition, menus, reconnect behavior, and local UX
- `frontend/telegram.md` — Telegram bot startup, bridge behavior, commands, and
  media flow
- `frontend/browser.md` — Browser SPA layout, agent/session sidebar, tabbed
  workspace, git diff/file preview, fixed right sidebar tools, terminal pane,
  and HTTP/API endpoints

### Features

- `features/agent-com.md` — inter-agent communication via `oc agent ask`
- `features/compaction.md` — auto-compact, manual `/compact`, replay markers,
  and frontend behavior
- `features/heartbeat.md` — heartbeat scheduling and delivery semantics
- `features/cron.md` — cron job discovery, scheduling, and result delivery
- `features/notify.md` — proposed out-of-band user notification delivery

## Archive Rule

When a plan ships, move the authoritative behavior into `design-specs/` and
replace the old plan with a short archive pointer. `dev/plans/` should not keep
competing sources of truth.
