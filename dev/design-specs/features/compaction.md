# Compaction

## Scope

Compaction is a cross-layer feature. It spans:

- backend SDK settings and event mapping
- runtime command policy
- history normalization
- TUI and Telegram rendering

No single architecture doc owns the end-to-end flow, so it lives here.

## Current Behavior

### Automatic compaction

- root config stores `autoCompact: boolean`
- `src/index.ts` passes that flag into each `ClaudeAdapter`
- the Claude adapter computes `settings.autoCompactWindow` as 80% of the
  resolved model context window

This is backend-owned because it depends on provider execution settings.

### Manual compaction

- `/compact` is part of the shared slash-command catalog
- its transport is `prompt`, not `runtime`
- TUI and Telegram must send it through the normal prompt path

Runtime command handlers must not treat `/compact` as a runtime command.

## Model Boundary

Model metadata lives in `src/common/models.ts`:

- alias -> resolved model id
- alias -> context window

Runtime uses that metadata for one policy check: blocking model switches when
current context usage is already above 80% of the target model's window.

After a successful model switch, runtime also recalculates the in-memory usage
snapshot against the newly selected model's context window and broadcasts a
fresh `runtime_status`. This keeps TUI/browser context meters aligned with the
selected model instead of the previous turn's window.

Error format:

```text
context too large for <model> (<tokens>/<cap>) — run /compact first
```

## Event Flow

Claude SDK status events are normalized by the adapter:

- `status === "compacting"` -> `compacting_started`
- `status === null` -> `compacting_finished`

History normalization also emits durable replay markers:

- compaction boundaries become `DisplaySystemMessage`
- transcript export excludes compaction plumbing

## Frontend Behavior

### TUI

- sends `/compact` as a prompt
- starts local compacting state immediately on submit
- shows `Compacting...` spinner until streamed text or finish arrives
- pushes `context compacted` when finish arrives
- replays compact boundaries as info rows
- warns on high context usage in the status bar

### Telegram

- registers `/compact` as a prompt command
- streams it through the same prompt bridge as normal prompts
- emits simple notices:
  - `Compacting context...`
  - `Context compacted.`

### Browser

- sends `/compact` through the normal prompt websocket path
- tracks per-chat compacting state from `compacting_started` /
  `compacting_finished`
- shows `Compacting...` in the thinking indicator while compaction is active
- replays compact boundaries as normal system messages via `history_replay`

## Ownership Split

- backend owns provider settings and compaction lifecycle mapping
- runtime owns model-switch policy, usage-window recalculation after model
  changes, and event fanout
- frontend owns local rendering of compaction state
- history normalization owns replay markers

That split should stay intact. Do not move Claude-specific compaction behavior
into runtime or frontend code.
