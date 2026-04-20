# TUI

## Overview

The TUI is a long-lived websocket client for one bound agent runtime. It
reconnects automatically, replays the active session history on connect, and
renders runtime events as structured transcript rows instead of one flat output
buffer.

See `../architecture/frontend.md` for the shared frontend contract and
`../architecture/runtime.md` for runtime-side websocket behavior.

## Document Scope

This document covers the current TUI internals:

- module ownership inside `src/frontend/tui/`
- terminal screen behavior and controls
- local TUI state such as session-menu behavior and collapsed paste handling
- prompt-vs-runtime slash-command routing

Runtime-owned behavior such as websocket event semantics, replay policy, and
broadcast rules is only summarized here when needed and remains owned by
`../architecture/runtime.md`.

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

- **header**: `OutCLAW` banner, rotating tagline, git status for `~/.outclaw/`,
  and missing-file checks for the expected multi-agent workspace layout
- **transcript**: user, assistant, thinking, info, and error messages, plus a spinner while the agent is running
- **composer**: the multiline input area, disabled while a run is active or
  while the session or agent menu is open
- **status bar**: websocket state plus agent, model, effort, context usage, and
  heartbeat countdown when known, plus the current frontend notice when present

Assistant output is rendered as markdown with `marked-terminal`. Thinking content is
rendered as dimmed markdown, appearing above the assistant response. User prompts are
shown as highlighted blocks. Runtime status updates and command feedback are rendered
as info rows inside the transcript.

## Module Ownership

The TUI is organized by feature boundary:

- `chrome/` owns presentation-only shell elements: header bar (figlet banner, tagline, git status), status bar (connection, model, effort, context, heartbeat), and theme tokens.
- `transcript/` owns display state and translation from runtime events into transcript actions.
- `composer/` owns editing behavior, paste collapsing, and raw stdin normalization.
- `sessions/` owns the interactive session menu, its derived display model, and local menu state updates.
- `command-menu/` owns the `/command` dropdown: state logic, prefix matching, and rendering.
- `app.tsx` is the composition boundary. It wires features together, but feature-specific logic stays inside its directory.

## Connection And Session Flow

- The TUI connects with `client=tui` and retries every 3 seconds after disconnect.
- The runtime sends `runtime_status` immediately on connect (without `requested`). The TUI updates the status bar but does not push a transcript message for unsolicited status events.
- Successful model switches also trigger an unsolicited `runtime_status` refresh
  after `model_changed`, so the status bar context meter reflects the new model
  window immediately.
- `runtime_status.notice` updates only the status bar; it is not rendered as a
  transcript row. Current shipped notices are `restart_required` and the
  runtime-supplied `rollover` message for the bound agent.
- The runtime replays the active session history after connect and after session switch.
- Interactive agent selection is shared with browser clients. Switching agents
  from the TUI rebinds connected browser clients to the same agent runtime, and
  browser-side agent switches rebind the TUI the same way.
- `/agent` opens an inline agent picker instead of printing text output.
- `/status` receives a `runtime_status` event with `requested: true`, which produces a visible info message in the transcript showing model, effort, session title, and formatted context usage.
- `/session` opens an interactive session menu instead of printing a plain list in the TUI.
- Session usage metadata is restored from SQLite on daemon startup and when switching sessions, so the status bar shows context usage immediately.
- Pressing `Esc` while a run is active sends `/stop` unless the session or agent
  menu is open.

## Slash Command Routing

The TUI distinguishes runtime commands from prompt-transport slash commands.

- runtime commands go through `sendRuntimeCommand()`
- prompt commands such as `/compact` go through `sendRuntimePrompt()`
- `/exit` is TUI-local and exits the process

This split mirrors `src/common/commands.ts`. The TUI must not special-case
compaction outside that shared command catalog.

## Agent Menu

`src/frontend/tui/agents/`

Controls:

- `Up` / `Down` — move selection
- `Enter` — switch to the selected agent
- `Esc` — dismiss the menu

The menu is populated from the supervisor's `agent_menu` event and only shows
agents available to the current client binding.

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

## Command Menu

When the user types `/`, a dropdown menu appears below the input area showing
available commands and skills. The menu combines built-in runtime commands with
SDK skills fetched from the adapter.

### Sources

- **Built-in commands** — Derived from `SLASH_COMMANDS` in
  `src/common/commands.ts` plus `/exit`. Model alias shortcuts (`/opus`,
  `/sonnet`, `/haiku`) are excluded.
- **Skills** — Fetched from the adapter via `Facade.getSkills()`. The adapter maintains an in-memory cache updated on every conversation's `system/init` event. On the first request, if no cache exists, the adapter probes the SDK locally (no API call, no internet required) and cleans up the throwaway session file.

### Display

- Items show `/command` name and description in two columns.
- Maximum 6 items visible at once; the list scrolls to keep the selection centered.
- When no prefix is typed (bare `/`), items are sorted alphabetically.
- When a prefix is typed, items are filtered by prefix match.
- The status bar is hidden while the menu is open.

### Controls

- `Up` / `Down` or `Ctrl+P` / `Ctrl+N` — navigate selection
- `Tab` or `Enter` — insert the selected command into the input (with trailing space) and close the menu
- `Esc` — dismiss the menu without inserting
- Any other key — continues typing, which filters the list

Enter and Tab always insert the command into the input rather than executing it
directly. The user presses Enter a second time (with the menu now closed) to
submit the command. This prevents accidental execution of the top-highlighted
item.

### Skill Discovery Flow

1. **Cold start** — User types `/`, TUI sends `request_skills` to runtime, runtime calls `facade.getSkills()`, adapter has no cache so it probes the SDK, returns the skill list.
2. **During conversation** — Every `query()` call yields a `system/init` event. The adapter extracts skills and updates its internal cache silently.
3. **Subsequent `/`** — Runtime calls `facade.getSkills()`, adapter returns its cache immediately. No probe needed.

The TUI guards against duplicate requests with a ref that latches on successful send and resets on reconnect.

## Composer

The composer uses `ink-multiline-input` only for rendering. Editing is driven by a
custom raw stdin layer so terminal shortcuts behave consistently across common
terminal escape sequences.

Supported editing behavior:

- `Enter` — send the current draft (or insert selected command when the command menu is open)
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

## Thinking Content

Thinking content from the agent's extended thinking is rendered as a distinct
message type:

- `ThinkingEvent` deltas are accumulated in a separate `streamingThinking` buffer.
- When streaming completes, thinking is committed as a `role: "thinking"` message
  placed above the assistant response.
- Thinking messages are rendered as dimmed markdown (same layout as assistant text
  but with `dim: true`), visually distinguishing them from the final response.
- History replay also surfaces thinking: `DisplayMessage.thinking` fields are
  rendered as separate thinking rows above the assistant content.

## Compaction

Compaction is surfaced as first-class UI state:

- `/compact` is sent as a prompt, not a runtime command
- live compaction shows a `Compacting...` spinner when no streamed text is yet
  visible
- `compacting_finished` pushes `context compacted`
- replayed compact boundaries are rendered as info/system rows
- the status bar warns on context usage at 65% (yellow) and 75% (red)

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

## Image Paste

TUI image paste is deferred and is not part of the current implementation plan.

Current behavior:

- The TUI supports text composition and collapsed large text pastes only.
- Terminal or clipboard image paste is not supported.
- User image input remains Telegram-owned through the existing `prompt +
  images[]` runtime contract.

If this is revisited later, the design should start from a reliable
terminal/clipboard ingestion strategy, keep the runtime provider-neutral, and
follow strict red-green-refactor TDD.
