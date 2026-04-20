# Telegram

## Overview

Telegram is a grammY-based frontend attached to the shared multi-agent runtime.
It owns chat-specific transport concerns: command registration, reply-context
extraction, reply-based media reuse, Telegram-native streaming, and managed file
storage around the runtime websocket bridge, including voice/audio ingestion.

See `../architecture/frontend.md` for the shared frontend contract and
`../architecture/runtime.md` for runtime-side websocket behavior.

## Document Scope

This document covers the current Telegram-specific behavior:

- module ownership inside `src/frontend/telegram/`
- Telegram command registration and Telegram-facing reply formatting
- Telegram media persistence and reply-image reuse
- Telegram delivery behavior for prompt, heartbeat, and cron output
- bot startup grouping by token

Runtime-owned behavior such as command semantics, event emission, replay, and
broadcast policy remains owned by `../architecture/runtime.md`. This document only
covers how the Telegram frontend maps onto those runtime contracts.

## Structure

`src/frontend/telegram/`

- `index.ts` — package entrypoint exporting `startTelegramBot()`
- `bot.ts` — grammY bot assembly, middleware, handler registration, and outbound delivery methods
- `bot-manager.ts` — groups agents by token, merges allowed users, and starts one bot per token
- `bridge/` — runtime websocket transport for prompt, command, and streaming operations
- `commands/` — runtime command definitions, Bot API command catalog, and model shortcut registration
- `sessions/` — session command parsing, inline keyboard presentation, and session handler registration
- `messages/` — inbound text/photo/document/voice handling, shared prompt
  streaming, and heartbeat result delivery
- `files/` — local file persistence, file-type resolution, and Telegram
  reply-based attachment reuse for image/document/voice refs

## Entry Point

`src/frontend/telegram/index.ts` + `src/frontend/telegram/bot.ts`

Startup sequence:

1. `bot-manager.ts` groups configured agents by bot token.
2. For each token group, merge allowed users and start one bot.
3. Register the global command list with Bot API from `TELEGRAM_COMMANDS`.
4. Install auto-retry middleware.
5. Install the `allowedUsers` guard while allowing `/start` through.
6. Register session handlers, runtime commands, prompt commands, model aliases,
   and text/photo/document/voice handlers.
7. Start long-polling.

The bot receives `filesRoot` and file-ref callbacks from `src/index.ts` for file
persistence. It exposes `sendCronResult()` and `sendHeartbeatResult()` so the runtime
can deliver background results back into Telegram.

If a token group has no allowed users, that bot is skipped.

`/start` is a Telegram-local helper and replies with the sender's numeric
Telegram user id before any agent-specific routing is required.

## Text Messages

`src/frontend/telegram/messages/text.ts`

1. If the message replies to a tracked Telegram image, document, or voice note,
   resolve that attachment through `TelegramFileRefStore`.
2. Send the text prompt plus any resolved reply images and prompt segments
   through `runTelegramPrompt`.
3. Track outbound images so later replies can reuse them.

## Photo Messages

`src/frontend/telegram/messages/photo.ts`

1. Fetch the largest photo variant from Telegram.
2. Download it and save it to `files/` through `saveTelegramFile()`.
3. Persist the `(chat_id, message_id) -> local path` mapping in `TelegramFileRefStore`.
4. Resolve any replied-to images and prepend them to the prompt images.
5. Use the caption as prompt text, or an empty string when absent.
6. Stream the combined prompt through `runTelegramPrompt`.

## Document Messages

`src/frontend/telegram/messages/document.ts`

1. Fetch the document file path from Telegram.
2. Download it and save it to `files/` through `saveTelegramFile()`.
3. Persist the `(chat_id, message_id)` mapping in `TelegramFileRefStore` with `kind: "document"`.
4. Resolve any replied-to images or documents.
5. Append the uploaded document as a prompt segment and stream the combined prompt through `runTelegramPrompt`.

## Voice And Audio Messages

`src/frontend/telegram/messages/voice.ts`

1. Handle both `message:voice` and `message:audio`.
2. Validate audio mime/size, fetch the Telegram file path, and download into
   managed `files/` storage.
3. Persist the `(chat_id, message_id)` mapping in `TelegramFileRefStore` with
   `kind: "voice"` plus optional `mimeType` and `durationSeconds`.
4. Resolve replied-to images, documents, or previous voice refs.
5. Append a `[voice note (...)]` or `[voice audio (...)]` prompt segment,
   preserve any caption, and stream the combined prompt through
   `runTelegramPrompt`.

## Bridge

`src/frontend/telegram/bridge/client.ts`

The Telegram bridge opens fresh runtime websocket connections per operation instead
of holding a long-lived socket inside the bot process.

Telegram sends prompt text plus any resolved reply images through the shared
`prompt + images[] + replyContext` runtime contract. Reply-targeted documents
and voice refs are converted into prompt text segments before crossing the
runtime boundary.

- `stream(prompt, images?, onImage?, telegramChatId?, replyContext?, routing?)` — yields text/thinking chunks and forwards outbound images through the callback
- `sendCommandAndWait(command, expectedTypes, routing?)` — waits for a matching command reply event. Skips unsolicited `runtime_status` events (sent on connect) but accepts ones with `requested: true`.
- `send(prompt, onText?, images?, telegramChatId?, replyContext?, routing?)` — collects a full text response

Each bridge call carries Telegram routing metadata (`telegramBotId`,
`telegramUserId`) so the supervisor can bind the operation to the correct agent.

Unexpected websocket close after open is treated as an operation failure so bot
handlers fail fast instead of hanging.

## Session Menu

`src/frontend/telegram/sessions/menu.ts` + `src/frontend/telegram/sessions/register.ts`

`/session` is handled separately from the generic runtime-command registration. The
runtime returns a `session_menu` event, and the bot renders one full-width inline
keyboard button per chat session. Tapping a button sends `/session <id>` back to the
runtime through the callback-query handler.

Callback data format is `ss:<sdkSessionId>`.

Telegram still supports text-command flows for:

- `/session list`
- `/session delete <id>`
- `/session rename <id> <title>`
- `/session <id-prefix>`

Those operations are intentionally not exposed in the inline keyboard.

## Runtime Commands

`src/frontend/telegram/commands/runtime.ts`

Each runtime command definition specifies:

- `buildCommand()` — translate Telegram input into a runtime command string
- `expectedTypes` — the runtime event types that constitute a reply
- `formatReply(event)` — convert the runtime event into user-facing Telegram text

The meaning of the underlying runtime commands is owned by
`../architecture/runtime.md`. This section only specifies the Telegram mapping and
presentation layer.

Supported commands:

| Command | Maps to | Reply format |
|---------|---------|--------------|
| `/agent` | `/agent` | agent menu or current agent |
| `/new` | `/new` | "Session cleared. Starting fresh." |
| `/model` | `/model` | "Model: {alias}" |
| `/thinking` | `/thinking` | "Thinking effort: {level}" |
| `/session` | handled in `sessions/` | Inline keyboard picker |
| `/status` | `/status` | Model, effort, session title, and compact context usage (`Xk/Yk (Z%)`) |
| `/stop` | `/stop` | Runtime status reply such as "Stopping current run" |
| `/restart` | `/restart` | Status message such as "Restarting daemon..." |

Model shortcuts (`/opus`, `/sonnet`, `/haiku`) are registered separately in
`commands/shortcuts.ts` and translate to `/model <alias>`.

Prompt-transport commands such as `/compact` are registered separately in
`commands/prompt.ts` and stream through the normal prompt path instead of
`sendCommandAndWait()`.

## Prompt Execution

`src/frontend/telegram/messages/prompt.ts`

Shared prompt execution flow:

1. Start `sendChatAction("typing")` on a 4-second interval.
2. Stream chunks from the bridge, routing `thinking` and `text` to separate drafts.
3. Thinking content is rendered as an expandable blockquote (`<blockquote expandable>`) in a separate message above the response.
4. Text content is streamed incrementally with periodic edits.
5. Compaction lifecycle chunks emit simple status messages (`Compacting context...`,
   `Context compacted.`).
6. For each outbound `ImageEvent`, send a Telegram photo reply.
7. Remember sent image message IDs for reply-based image reuse.
8. Stop the typing loop when streaming completes.

Telegram chunking is handled locally by `markdownToTelegramHtml()` plus
`splitTelegramHtml()`. Streaming uses one editable preview per draft and finalizes
overflow into additional messages around Telegram's 4096-character limit.

## File Management

`src/frontend/telegram/files/storage.ts`

- `saveTelegramFile(filesRoot, url, ext)` — download a Telegram file into `files/YYYY/MM/DD/{uuid8}{ext}`
- `copyTelegramFile(filesRoot, path)` — normalize outbound local files into managed storage when needed

`src/frontend/telegram/files/image-info.ts`

- `getImageInfo(filePath)` — resolve file extension to supported Telegram image media type

`src/frontend/telegram/files/message-file-ref.ts`

- `resolveReplyAttachments(...)` — resolve reply-targeted images, documents,
  and voice refs for inbound prompts
- `formatTelegramVoicePromptRef(...)` — format voice attachments into prompt text segments
- `rememberOutboundImage(...)` — persist outbound image references for later reply reuse
- `formatTelegramDocumentPromptRef(...)` — format document attachments into prompt text segments

File lifecycle summary:

```text
Inbound:
  Telegram photo/document -> download -> files/YYYY/MM/DD/uuid.ext
                                     -> telegram_file_refs (direction: inbound)
                                     -> image in PromptMessage or document prompt segment
  Telegram voice/audio    -> download -> files/YYYY/MM/DD/uuid.ext
                                     -> telegram_file_refs (direction: inbound, kind: voice)
                                     -> voice prompt segment

Outbound:
  Agent output -> runtime image-event-extractor -> ImageEvent
              -> Telegram replyWithPhoto
              -> copy to files/ if needed
              -> telegram_file_refs (direction: outbound)

Reply reuse:
  User replies to any tracked message
    -> look up (chat_id, reply_message_id) in telegram_file_refs
    -> if found, attach reply images or append document/voice prompt segments
```

## Command Registry

`src/frontend/telegram/commands/catalog.ts`

`TELEGRAM_COMMANDS` is the `BotCommand[]` passed to grammY's `setMyCommands()`. It
is built from runtime commands plus prompt-transport commands such as `/compact`.
`/session` remains a separate session-keyboard flow even though it also appears
in the Bot API command list.

## Background Result Delivery

`src/frontend/telegram/messages/heartbeat-result.ts`

`sendTelegramHeartbeatResult()` sends heartbeat images first, then text, with
`disable_notification: true`. Outbound images are persisted through
`rememberMessageFile`.

The runtime calls this Telegram path only when the agent's current
`last_user_target` is a Telegram chat. Interactive (`tui`) heartbeats are not
mirrored into Telegram. Browser-targeted interactive activity shares that same
non-Telegram path and is also not mirrored into Telegram.

Cron results are delivered separately through the bot service as silent text
messages when a bot exists for that agent. Cron target resolution is explicit
and does not use `last_user_target`.

`src/frontend/telegram/bot.ts`

`sendCronResult()` formats cron output as `[cron] {jobName}\n{text}` and sends it
through the bot API with `disable_notification: true`.
