# Frontend

## Design Principles

Frontends are thin I/O adapters. They capture user input, render agent output, and maintain no business logic. All frontends connect to the runtime daemon over WebSocket using the shared protocol.

Multiple frontends can connect simultaneously and share the same active session. State changes (session clear, model switch) are broadcast to all connected clients.

## Shared Runtime Client

`src/frontend/runtime-client/index.ts`

Common WebSocket helpers used by both TUI and Telegram:

- `buildRuntimeSocketUrl(url, clientType)` — Appends `?client=tui|telegram` to the runtime URL.
- `openRuntimeSocket(url, clientType)` — Opens a WebSocket connection, returns `{ws, ready, close()}`.
- `isRuntimeSocketOpen(ws)` — Guards send operations against stale sockets.
- `closeRuntimeSocket(ws)` — Closes sockets that are still connecting or open.
- `sendRuntimePrompt(ws, prompt, source?, images?, telegramChatId?)` — Serializes and sends a `PromptMessage`.
- `sendRuntimeCommand(ws, command)` — Serializes and sends a `CommandMessage`.

## TUI

`src/frontend/tui/`

Terminal interface built with Ink. Rendering is split into focused components and
state reducers rather than a single flat output buffer.

Structure:

- `index.tsx` — exports `startTui()`
- `app.tsx` — screen composition and user interaction wiring
- `chrome/` — shell-only presentation (`HeaderBar`, `StatusBar`, `theme`)
- `transcript/` — transcript state, runtime-event mapping, message formatting, and rendering
- `composer/` — multiline editor state machine, paste collapsing, and raw terminal parsing
- `sessions/` — interactive session menu component, derived menu view model, and local menu state updates
- `use-runtime-session.ts` — runtime websocket lifecycle and local TUI state synchronization
- `use-terminal-size.ts` — terminal resize tracking

### Components

Single-screen layout:

- **Header** — `HeaderBar` renders an `OutCLAW` figlet banner.
- **Transcript** — `MessageList` renders structured `user`, `assistant`, `info`, and `error` rows.
- **Composer** — `TextArea` renders the multiline draft while custom key handling owns editing behavior.
- **Status bar** — `StatusBar` shows connection state, model, effort, and context usage percentage.

Relevant modules:

- `transcript/runtime-events.ts` — maps runtime events to transcript actions
- `transcript/reducer.ts` — applies transcript actions to local transcript state
- `transcript/message-list.tsx` / `transcript/message-item.tsx` — transcript rendering
- `transcript/markdown.ts` — assistant markdown rendering through `marked-terminal`
- `composer/paste-draft.ts` — collapsed paste placeholder tracking and expansion on send
- `composer/text-area.tsx`, `composer/keypress.ts`, `composer/edit.ts`, `composer/input.ts`, and `composer/terminal/parser.ts` — multiline editor behavior and raw terminal parsing

### Interaction

- Text input submits as a prompt and is rendered locally as a structured user message.
- Commands starting with `/` are sent as runtime commands (except `/exit` which exits the process).
- `Escape` while the agent is running sends `/stop` to abort generation.
- The composer is disabled while a run is active or while the session menu is open.
- Large pastes over 3 lines are collapsed to visible summary tokens and expanded back to full content only when sent.

See `dev/design-specs/tui.md` for the detailed composer controls and paste behavior.

### Session Menu

`src/frontend/tui/sessions/`

The `/session` command opens an interactive session picker that replaces the
composer. Sessions are listed with title, relative timestamp, and an active marker
(`●`).

Navigation:
- `↑`/`↓` — move cursor
- `Enter` — switch to the selected session
- `d` — delete the selected session
- `r` — rename inline using the same `TextArea` editor in single-line mode; `Enter` confirms, `Esc` cancels
- `Esc` — dismiss the menu

Cron sessions are filtered out. Only `tag: "chat"` sessions appear. Title is
truncated with `...` to fit the terminal width, with the timestamp right-aligned.

### Event rendering

`transcript/runtime-events.ts` maps runtime events to display updates, and
`transcript/reducer.ts` applies those actions to local transcript state:

| Event | Rendering |
|-------|-----------|
| `text` | Appended to the streaming assistant buffer |
| `image` | `[image: /path/to/file.png]` |
| `user_prompt` | Structured user message for Telegram or heartbeat traffic; TUI-local prompts are not echoed back |
| `status` | Informational message row |
| `error` | Error message row and stop state |
| `done` | Commits the streaming assistant buffer into a final assistant message |
| `runtime_status` | Informational message row and status-bar metadata refresh |
| `history_replay` | Rebuilds structured transcript state from stored display messages |
| `session_menu` | Opens the interactive session picker |
| `session_cleared` | Clears transcript and local run state |
| `session_switched` | Clears transcript; replayed history arrives in the following `history_replay` event |
| `session_renamed` | No transcript change; menu updates locally |
| `session_deleted` | No transcript change; menu updates locally |
| `model_changed` | Informational message row plus status-bar model refresh |
| `effort_changed` | Informational message row plus status-bar effort refresh |
| `cron_result` | `[cron] {jobName}` followed by result text |

### WebSocket lifecycle

Single persistent connection opened on mount. On disconnect the TUI retries after 3
seconds. `runtime_status` is sent immediately on connect, and the active session
history is replayed after connect or session switch.

## Telegram

`src/frontend/telegram/`

Telegram bot built with grammY, connected to the runtime via WebSocket bridge.

Structure:

- `index.ts` — package entrypoint exporting `startTelegramBot()`
- `bot.ts` — grammY bot assembly, middleware, handler registration, and outbound delivery methods
- `bridge/` — runtime websocket transport for prompt, command, and streaming operations
- `commands/` — runtime command definitions, Bot API command catalog, and model shortcut registration
- `sessions/` — session command parsing, inline keyboard presentation, and session handler registration
- `messages/` — inbound text/photo handling, shared prompt streaming, and heartbeat result delivery
- `media/` — local media persistence, file-type resolution, and Telegram reply-image reuse

### Entry point

`src/frontend/telegram/index.ts` + `src/frontend/telegram/bot.ts`

Startup sequence:
1. Register global command list with Bot API (from `TELEGRAM_COMMANDS` via `commands/catalog.ts`).
2. Install auto-retry middleware and streaming support.
3. Install `allowedUsers` guard — rejects messages from unauthorized Telegram users.
4. Register handlers: runtime commands, session handlers, model shortcut commands, text messages, photo messages.
5. Start long-polling.

Receives `mediaRoot` and media-ref callbacks from `src/index.ts` for image persistence. Exposes `sendCronResult()` and `sendHeartbeatResult()` methods for runtime-initiated delivery.

### Text messages

`src/frontend/telegram/messages/text.ts`

1. Check if the message is a reply — if so, resolve the referenced image via `TelegramMediaRefStore`.
2. Send prompt (text + any resolved images) to runtime via `runTelegramPrompt`.
3. Track any outbound images sent in the response.

### Photo messages

`src/frontend/telegram/messages/photo.ts`

1. Fetch the largest photo variant from Telegram (`ctx.message.photo[-1]`).
2. Download via Telegram API and save to `media/` using `saveTelegramMedia`.
3. Persist the `(chat_id, message_id) -> local path` mapping in `TelegramMediaRefStore`.
4. Check for reply-referenced images and combine with the inbound photo.
5. Use caption as prompt text (empty string if absent).
6. Send via `runTelegramPrompt`.

### Bridge

`src/frontend/telegram/bridge/client.ts`

WebSocket client pool for communicating with the runtime. Creates fresh connections per operation:

- **`stream(prompt, images?, onImage?, telegramChatId?)`** — Returns an `AsyncIterator` yielding text chunks. Accepts an `onImage` callback for outbound image events. Used for prompt execution with streaming response.
- **`sendCommandAndWait(command, expectedTypes)`** — Sends a command and waits for a specific event type. Filters out noise (text, done, etc.). Used for `/model`, `/session`, etc.
- **`send(prompt, onText?, images?, telegramChatId?)`** — Sends a prompt and resolves with the collected text response. Used internally.
- Unexpected WebSocket close after a connection is opened is treated as an operation failure. Bridge calls reject or throw with a close error instead of hanging indefinitely.

### Session Menu

`src/frontend/telegram/sessions/menu.ts` + `src/frontend/telegram/sessions/register.ts`

The `/session` command is handled separately from the generic command registration. It replies with an inline keyboard listing chat sessions. Each button shows the session title with an active marker (`●`). Tapping a button switches to that session via callback query.

Flow:
1. `/session` → runtime returns `session_menu` event with sessions list.
2. Bot builds an `InlineKeyboard` with one full-width button per session.
3. User taps a button → callback query handler sends `/session <id>` to the runtime.
4. Bot edits the original message to confirm the switch.

Callback data format is `ss:<sdkSessionId>` for switch only. Telegram still supports
`/session list`, `/session delete <id>`, `/session rename <id> <title>`, and
`/session <id-prefix>` as text-command flows; those operations are just not exposed in
the inline keyboard.

### Runtime commands

`src/frontend/telegram/commands/runtime.ts`

Command definitions, each specifying:
- `buildCommand()` — Translates Telegram command text to runtime command string.
- `expectedTypes` — Which server event types constitute a reply.
- `formatReply(event)` — Formats the server event into user-facing Telegram text.

| Command | Maps to | Reply format |
|---------|---------|--------------|
| `/new` | `/new` | "Session cleared. Starting fresh." |
| `/model` | `/model` | "Model: {alias}" |
| `/thinking` | `/thinking` | "Thinking effort: {level}" |
| `/session` | (handled in `sessions/`) | Inline keyboard picker — see Session Menu above |
| `/status` | `/status` | Model, effort, session, token usage percentage |
| `/stop` | `/stop` | Runtime status message, e.g. "Stopping current run" or "Nothing to stop" |

Model shortcuts (`/opus`, `/sonnet`, `/haiku`) are registered separately in `commands/shortcuts.ts` and map to `/model <alias>`.

Exported `TELEGRAM_COMMANDS` array is used at startup to register the command list with the Telegram Bot API.

### Prompt execution

`src/frontend/telegram/messages/prompt.ts`

Shared helper for sending prompts and streaming responses back to Telegram:

1. Start `sendChatAction("typing")` on a 4-second interval.
2. Get the first text chunk from the bridge stream.
3. If non-empty, open `replyWithStream()` for incremental Telegram message editing.
4. For each `ImageEvent` during streaming, send via `ctx.replyWithPhoto()`.
5. Track outbound image message IDs for reply-based reuse.
6. Clean up typing indicator on completion.

### Image management

**`src/frontend/telegram/media/storage.ts`** — File I/O for Telegram images:
- `saveTelegramMedia(mediaRoot, url, ext, mediaType)` — Download from Telegram API, write to `media/YYYY/MM/DD/{uuid8}.{ext}`, return `ImageRef`.
- `copyTelegramMedia(mediaRoot, path, ext, mediaType)` — If a file is already inside `media/`, return it as-is; otherwise copy into managed storage.

**`src/frontend/telegram/media/image-info.ts`** — Extension-to-media-type mapping:
- `getImageInfo(filePath)` — Returns `{ext, mediaType}` from file extension. Throws on unsupported types.

**`src/frontend/telegram/media/message-image-ref.ts`** — Reply resolution and outbound tracking:
- `resolveMessageImage(ctx, resolveImage)` — If the message is a reply, look up the referenced message's image in `TelegramMediaRefStore`. Returns `ImageRef[]` (0 or 1).
- `rememberSentImage(ctx, messageId, image, rememberMessageImage)` — Persist an outbound image's `(chat_id, message_id)` mapping for future reply reuse.

### Image lifecycle summary

```
Inbound:
  Telegram photo -> download -> media/YYYY/MM/DD/uuid.ext
                              -> telegram_media_refs (direction: inbound)
                              -> ImageRef in PromptMessage -> runtime -> backend (base64)

Outbound:
  Agent output -> runtime image-event-extractor -> ImageEvent
              -> Telegram replyWithPhoto
              -> copy to media/ if needed
              -> telegram_media_refs (direction: outbound)

Reply reuse:
  User replies to any tracked message
    -> look up (chat_id, reply_message_id) in telegram_media_refs
    -> if found, attach ImageRef to new prompt
```

### Command registry

`src/frontend/telegram/commands/catalog.ts`

Exports `TELEGRAM_COMMANDS` as a `BotCommand[]` array for the grammY Bot API `setMyCommands()` call. It is built from the runtime command definitions plus `/session`, which is handled by the separate session keyboard flow.

### Heartbeat result delivery

`src/frontend/telegram/messages/heartbeat-result.ts`

`sendTelegramHeartbeatResult(ctx, params)` — Delivers buffered heartbeat output to a Telegram chat. Sends images first (via `sendPhoto`), then text (via `sendMessage`). All messages are sent with `disable_notification: true`. Outbound images are persisted via `rememberMessageImage` for reply-based reuse.

### Cron result delivery

`src/frontend/telegram/bot.ts`

`sendCronResult()` sends cron output directly through the bot API. It formats the
result as `[cron] {jobName}\n{text}` and sends it with
`disable_notification: true`.

### Chunking

Telegram message length limit (4096 chars) is handled by `@grammyjs/stream` via the `replyWithStream()` API, which manages incremental message editing and splitting.

## Open Questions

1. **TUI image input** — No support for sending images from TUI yet.
2. **Browser frontend** — Same WS protocol, different renderer. Not implemented.
