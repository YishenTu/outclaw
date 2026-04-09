# TUI

## Overview

The TUI is a websocket client for the shared runtime session. It reconnects
automatically, replays the active session history on connect, and renders runtime
events as structured message rows instead of a single flat output buffer.

Core entry points:

- `src/frontend/tui/index.tsx` — directory entrypoint exporting `startTui()`
- `src/frontend/tui/app.tsx` — top-level shell composing transcript, composer, sessions, and chrome
- `src/frontend/tui/use-runtime-session.ts` — websocket lifecycle, reconnect loop, runtime metadata, and local transcript updates
- `src/frontend/runtime-client/index.ts` — websocket open/close helpers and prompt/command send helpers
- `src/frontend/tui/transcript/` — transcript state, runtime-event mapping, formatting, markdown, and message rendering
- `src/frontend/tui/composer/` — multiline editor behavior, paste collapsing, and raw terminal input handling
- `src/frontend/tui/sessions/` — session menu types, formatting, inline menu component, and session-menu state updates
- `src/frontend/tui/chrome/` — header, status bar, and theme

## Screen Layout

The screen is composed of four persistent regions:

- header: an `OutCLAW` figlet banner
- transcript: user, assistant, info, and error messages, plus a spinner while the agent is running
- composer: the multiline input area, disabled while a run is active or while the session menu is open
- status bar: websocket connection state plus model, effort, and context percentage when known

Assistant output is rendered as markdown with `marked-terminal`. User prompts are shown
as highlighted blocks. Runtime status updates and command feedback are rendered as info
rows inside the transcript.

## Module Ownership

The TUI is organized by feature boundary:

- `chrome/` owns presentation-only shell elements.
- `transcript/` owns display state and translation from runtime events into transcript actions.
- `composer/` owns editing behavior, paste collapsing, and raw stdin normalization.
- `sessions/` owns the interactive session menu, its derived display model, and local menu state updates.
- `app.tsx` is the composition boundary. It wires features together, but feature-specific logic stays inside its directory.

## Connection And Session Flow

- The TUI connects with `client=tui` and retries every 3 seconds after disconnect.
- The runtime sends `runtime_status` immediately on connect.
- The runtime replays the active session history after connect and after session switch.
- `/session` opens an interactive session menu instead of printing a plain list in the TUI.
- Session usage metadata is restored from SQLite when switching sessions, so the status bar can recover saved context usage.
- Pressing `Esc` while a run is active sends `/stop` unless the session menu is open.

## Session Menu

Session menu controls:

- `Up` / `Down` — move selection
- `Enter` — switch to the selected session
- `d` — delete the selected session
- `r` — rename the selected session
- `Esc` — dismiss the menu

Rename mode:

- `Enter` — confirm rename
- `Esc` — cancel rename

## Composer

The composer uses `ink-multiline-input` only for rendering. Editing is driven by a
custom raw stdin layer so terminal shortcuts behave consistently across common
terminal escape sequences.

Supported editing behavior:

- `Enter` — send the current draft
- `Shift+Enter`, `Alt+Enter`, `Ctrl+J` — insert a newline
- `Up` / `Down` or `Ctrl+P` / `Ctrl+N` — move vertically, preserving the preferred column
- `Left` / `Right` or `Ctrl+B` / `Ctrl+F` — move by character
- `Home` / `End` or `Ctrl+A` / `Ctrl+E` — move to start or end of the current line
- `Backspace`, `Delete`, `Ctrl+H`, `Ctrl+D` — delete backward or forward
- `Ctrl+U` — kill to line start; at the start of a line it removes the previous line
- `Ctrl+K` — kill to line end
- `Ctrl+W` — delete the previous word
- `Alt+Backspace` — delete the previous word
- `Alt+B` / `Alt+F` — move by word
- `Alt+D` — delete the next word
- `Ctrl+C` — exit the process

## Large Paste Handling

Large pasted blocks are collapsed only in the visible draft. The hidden original text
is restored just before send.

Rules:

- A paste is collapsed when it inserts more than 3 lines in one edit operation.
- The visible token format is `[pasted content #N: X lines]`.
- Multiple collapsed pastes can exist in one draft and are renumbered from left to right.
- Typing before, between, or after collapsed tokens keeps the hidden pasted content attached to the corresponding token.
- Editing inside a collapsed token releases it back to normal plain text, so it stops expanding on send.
- Pressing `Enter` expands every remaining collapsed token and sends the full text.
- Pressing `Esc` clears the whole draft if any collapsed paste tokens are still present.

Example:

```text
[pasted content #1: 4 lines] hello [pasted content #2: 8 lines]
```

What you see in the editor stays compact. What the runtime receives is the full pasted
content with `hello` between the two expanded blocks.
