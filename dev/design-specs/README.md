# Current Codebase Docs

This tree documents the implementation currently in the repository. The
`design-specs/` directory name is historical; these files are meant to explain
how the codebase works today, not define a separate future-state spec.

## Layout

- `architecture/` — durable system boundaries and invariants
- `cli/` — `oc` command surfaces and process-level command orchestration
- `frontend/` — surface-specific TUI, Telegram, and browser behavior
- `features/` — cross-layer behaviors that span multiple boundaries
- `roadmap.md` — lightweight backlog / progress tracker kept as-is for personal
  planning

## Boundary Rules

- `architecture/*.md` describe structural boundaries: identity, layering,
  storage, routing, provider boundaries, prompt assembly.
- `cli/*.md` describe the local command UX and process-level behaviors under
  `src/cli/`.
- `frontend/*.md` describe surface-specific rendering, controls, and transport
  usage. They do not redefine runtime semantics.
- `features/*.md` describe cross-layer behaviors that span backend, runtime,
  and frontend, such as compaction.
- `roadmap.md` remains backlog only and is intentionally separate from the
  implementation docs.

## Ownership Heuristics

- If the behavior is enforced by a layer boundary or persistence invariant, it
  belongs in `architecture/`.
- If the behavior is about a concrete operator command, it belongs in `cli/`.
- If the behavior is about how one frontend renders or captures input, it
  belongs in `frontend/`.
- If the behavior spans multiple layers and needs end-to-end sequencing, it
  belongs in `features/`.

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

- `cli/daemon.md` — `oc build|start|stop|restart|status|dev|tui|browser`
  lifecycle and side effects
- `cli/agent.md` — `oc agent ...` lifecycle and side effects
- `cli/config.md` — `oc config runtime|secure` config mutation behavior
- `cli/session.md` — shipped `oc session ...` operator surface: list, search, transcript, and scoping

### Frontend

- `frontend/tui.md` — TUI composition, menus, reconnect behavior, and local UX
- `frontend/telegram.md` — Telegram bot startup, bridge behavior, commands, and
  media flow
- `frontend/browser.md` — Browser welcome page, workspace layout, daemon-served
  SPA vs Vite dev-server behavior, fixed right sidebar tools, and HTTP/API
  endpoints

### Features

- `features/agent-com.md` — inter-agent communication via `oc agent ask`
- `features/compaction.md` — auto-compact, manual `/compact`, replay markers,
  and frontend behavior
- `features/heartbeat.md` — heartbeat scheduling, deferral, live interactive
  delivery, and Telegram forwarding
- `features/session-rollover.md` — idle-based active-session detachment, final
  rollover prompt, and one-time user notice
- `features/cron.md` — cron job discovery, scheduling, browser enable toggles,
  and result delivery
- `features/voice-mode.md` — Telegram voice/audio ingestion plus the bundled
  Gemini transcription skill

Unshipped proposals do not live in this tree. Keep them under `dev/plans/` so
the current-codebase docs stay implementation-focused.

## Archive Rule

When a plan ships, fold the implemented behavior into this tree and replace the
old plan with a short archive pointer. `dev/plans/` should not compete with the
current-codebase docs.
