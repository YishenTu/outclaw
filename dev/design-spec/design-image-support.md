# Image Support Design

## Overview

This design now has two implemented phases:

1. **Phase 1: Inbound image prompts**
   - Telegram user sends a photo
   - The photo is persisted under the daemon's media root
   - The agent sees the image via Claude's vision input
   - Other clients and session replay continue to show that the prompt included images

2. **Phase 2: Outbound Telegram image delivery**
   - The backend detects verified local image files mentioned by Claude/tool output
   - The runtime emits `ImageEvent`s alongside normal text streaming
   - Telegram sends those files back to the user with `replyWithPhoto`
   - TUI observers see live outbound image markers

3. **Phase 3: Reply-based image reuse**
   - Telegram reply references can reattach a previously stored image
   - The bot persists `chat_id + message_id -> local image path` mappings
   - The mapping lives in the same SQLite file as sessions, but in a separate table/store

These three phases complete the current image-transfer scope. Remaining work is backlog, not a required next phase of this design.

## Scope

1. **Inbound**: Telegram photo -> local storage -> agent (vision)
2. **Outbound**: Agent/tool-produced local image -> runtime `ImageEvent` -> Telegram `replyWithPhoto`
3. **Display/Replayed history**: Inbound image prompts remain visible to observers and after reconnect/session switch; outbound images are visible live
4. **Reference reuse**: Telegram replies can reattach a previously known image from the same chat
5. **Storage**: All inbound images persisted in `media/` with date-based organization
6. **Out of scope**: Albums/media groups, non-image media types, and replaying outbound image events after reconnect/session switch

## Inbound: Telegram → Agent

### Telegram handler

Add `bot.on("message:photo", ...)` in `src/frontend/telegram/index.ts`.

- `ctx.message.photo` is a `PhotoSize[]` sorted by resolution — take the last (largest).
- `ctx.getFile()` returns a `File` with `file_path` — download from `https://api.telegram.org/file/bot<token>/<file_path>`.
- `ctx.message.caption` carries the user's text (if any). Treat as the prompt; use `""` when absent.
- `startTelegramBot()` receives `mediaRoot` from `src/index.ts`, so Telegram does not guess the daemon's storage location.
- Save the downloaded file under `mediaRoot` (see Storage below), then send a `PromptMessage` with `images: [savedImage]`.
- Phase 1 handles a single Telegram photo message. Album batching via `media_group_id` is deferred.

### Protocol changes (`src/common/protocol.ts`)

Extend prompt and display types:

```typescript
export type ImageMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp";

export interface ImageRef {
  path: string;       // absolute path to file on disk
  mediaType: ImageMediaType;
}

export interface DisplayImage {
  path?: string;      // present for live local prompts, absent when replay cannot recover it
  mediaType?: ImageMediaType;
}

export interface PromptMessage {
  type: "prompt";
  prompt: string;
  images?: ImageRef[];
  source?: "telegram";
}

export interface ImageEvent {
  type: "image";
  path: string;       // absolute path to a verified local image file
  caption?: string;
}

export interface DisplayMessage {
  role: "user" | "assistant";
  content: string;
  images?: DisplayImage[];
}

export interface UserPromptEvent {
  type: "user_prompt";
  prompt: string;
  images?: DisplayImage[];
  source: string;
}

export interface HistoryReplayEvent {
  type: "history_replay";
  messages: DisplayMessage[];
}
```

`RunParams` (facade contract) gets the same `images?: ImageRef[]` field so the backend adapter receives them, and `FacadeEvent` / `ServerEvent` include `ImageEvent`.

### Runtime client (`src/frontend/runtime-client/index.ts`)

`sendRuntimePrompt` gains an optional `images` parameter and serializes it into the WebSocket message.

### Runtime controller (`src/runtime/application/runtime-controller.ts`)

`IncomingMessage` adds `images?: ImageRef[]`.

- A prompt run is valid when `prompt !== ""` **or** `images.length > 0`.
- Forward `images` to `facade.run({ prompt, images, ... })`.
- Broadcast `user_prompt` with `images` so TUI observers can see image prompts live.
- Session title derivation must handle image-only prompts: use trimmed text when present, otherwise `"Image"` / `"<n> images"`.

### History replay (`src/runtime/persistence/history-reader.ts`)

Current replay only keeps plain-string user prompts. With multimodal input, that would silently drop image prompts after reconnect/session switch.

- Parse user message content arrays from the Claude session history.
- Extract text blocks into `content`.
- Extract image blocks into `DisplayImage[]`.
- Do not assume replay can recover the original local path after the adapter has converted the image to base64 for Claude.
- Return `HistoryReplayEvent["messages"]` so TUI replay preserves image prompts.

### Backend adapter (`src/backend/adapters/claude.ts`)

When `images` is present, build a `ContentBlockParam[]` instead of a plain string prompt:

```typescript
const content: ContentBlockParam[] = [];

for (const img of images) {
  const data = Buffer.from(await Bun.file(img.path).arrayBuffer()).toString("base64");
  content.push({
    type: "image",
    source: { type: "base64", data, media_type: img.mediaType },
  });
}

if (prompt) {
  content.push({ type: "text", text: prompt });
}
```

Pass this to `query()` using the `AsyncIterable<SDKUserMessage>` prompt form. The installed SDK already types `query({ prompt: string | AsyncIterable<SDKUserMessage> })`, and `SDKUserMessage.message` is a `MessageParam`.

## Display: Runtime/TUI

### TUI live output

For live `user_prompt` events:

- Keep the existing text line when a caption exists.
- Render each image as `[image: <absolute path>]` on its own line.
- Image-only prompts must still render something visible.

### TUI history replay

For `history_replay`:

- Re-render user messages with their text plus `[image: <path>]` lines.
- When replay lacks a recoverable path, render `[image]`.
- Assistant history still replays as text only in the current implementation.

## Outbound: Agent -> Runtime -> Telegram

Claude does not generate images natively. Outbound images come from tools or local files created during a run.

### Backend detection

The backend adapter scans non-stream Claude SDK events for absolute local paths that:

- end with a supported image extension (`png`, `jpg`, `jpeg`, `gif`, `webp`)
- exist on disk at the time the event is processed
- have not already been emitted during the current run

When a match is found, the adapter yields:

```typescript
{
  type: "image",
  path: "/absolute/path/to/generated-image.png",
}
```

### Runtime transport

- `ImageEvent` is forwarded to the prompt sender just like text and done events.
- Telegram-originated runs also broadcast `ImageEvent` to other connected clients.
- `sendCommandAndWait()` ignores `image` events by default, the same way it ignores text streaming noise.

### Telegram delivery

Telegram text streaming still uses `replyWithStream()`, but outbound images require a side channel because Telegram photos are separate API calls.

Add a small shared helper (`src/frontend/telegram/run-prompt.ts`) that:

- keeps the typing indicator alive
- passes an `onImage` callback into `bridge.stream(...)`
- sends each image via `ctx.replyWithPhoto(new InputFile(path), ...)`
- peeks the first text chunk before opening `replyWithStream()`, so image-only replies do not create an empty text message

This helper is reused for both plain text prompts and inbound Telegram photo prompts.

## Reply-Based Reuse

Telegram reply is the explicit reference mechanism for reusing an older image.

### Resolution model

- On inbound Telegram photos, persist a mapping from `(chat_id, message_id)` to the saved local image file.
- On outbound Telegram photos, first copy the file into managed `media/` storage, then persist the same mapping using the message ID returned by `replyWithPhoto(...)`.
- On a later text or photo message, if `reply_to_message` is present, look up that referenced Telegram message.
- If a mapping exists, append the resolved file to `images[]` before sending the prompt to the runtime.

This avoids heuristic text matching such as "the previous image" and survives process restarts because the mapping is persisted.

### Persistence boundary

Do not add Telegram media-ref logic to `SessionStore`. Keep it separate:

- same SQLite file: `~/.misanthropic/db.sqlite`
- separate table: `telegram_media_refs`
- separate store module: `TelegramMediaRefStore`

Current table shape:

```sql
CREATE TABLE telegram_media_refs (
  chat_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  path TEXT NOT NULL,
  media_type TEXT NOT NULL,
  direction TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (chat_id, message_id)
)
```

## Storage

### Location

`{daemonHome}/media/`

In this repo, `src/index.ts` already defines the daemon home directory (`HOME_DIR`) and passes `cwd: HOME_DIR` into the runtime. The Telegram bot should receive `mediaRoot = join(HOME_DIR, "media")` explicitly from there.

### Organization

Date-based directory structure:

```
media/
  2026/
    04/
      07/
        a1b2c3d4.jpg
        e5f6a7b8.png
```

- Directories created on demand.
- Filename: short random ID (e.g., 8-char hex from `crypto.randomUUID()`) + original extension.
- This avoids name collisions, keeps paths predictable, and is easy to browse by date.

### Helper module

New file: `src/frontend/telegram/media.ts`

```typescript
/** Download a URL and save to mediaRoot with date-based organization. */
export async function saveTelegramMedia(
  mediaRoot: string,
  url: string,
  ext: string,
  mediaType: ImageMediaType,
): Promise<ImageRef>;
```

Used by the Telegram photo handler. If future frontends or tools need the same behavior, that can be extracted later after a second caller appears.

### Wipe / retention

There is no automatic wipe or GC in the current implementation.

That is intentional. Reply-based reuse depends on stable local files, so an automatic age-based sweep would silently break valid Telegram reply references.

For now:

- inbound Telegram uploads are durable once written to `media/`
- outbound Telegram image refs are also promoted into `media/` before they are indexed
- reply resolution ignores refs whose target file no longer exists
- any future GC must delete DB refs and files together, not independently

## File Change Summary

| File | Change |
|------|--------|
| `src/common/protocol.ts` | Add `ImageMediaType`, `ImageRef`, `ImageEvent`, `images?` on prompt/display types, extend replay/live prompt events |
| `src/backend/adapters/image-events.ts` | **New** — extract verified local image paths from Claude/tool output |
| `src/frontend/telegram/media.ts` | **New** — `saveTelegramMedia()` helper |
| `src/frontend/telegram/image-info.ts` | **New** — normalize image extension/media-type handling for inbound and outbound files |
| `src/frontend/telegram/message-image-ref.ts` | **New** — shared reply-resolution and outbound-image persistence helpers |
| `src/frontend/telegram/run-prompt.ts` | **New** — shared Telegram prompt runner for text streaming plus outbound photos |
| `src/frontend/telegram/text-message.ts` | **New** — Telegram text prompt handler with reply-based image reattachment |
| `src/frontend/telegram/index.ts` | Add `message:photo` handler, accept `mediaRoot`, route text prompts through shared handlers, and inject media-ref persistence callbacks |
| `src/frontend/telegram/photo-message.ts` | Save inbound uploads, persist Telegram message refs, resolve replied-to images, and reuse shared outbound-image delivery |
| `src/frontend/telegram/bridge.ts` | Pass inbound `images`, surface outbound `ImageEvent`s during streaming, and ignore them for command waits |
| `src/frontend/runtime-client/index.ts` | Extend `sendRuntimePrompt` with `images` param |
| `src/runtime/application/runtime-controller.ts` | Accept image-only prompts, forward `images`, broadcast image prompts and outbound image events |
| `src/runtime/application/runtime-state.ts` | Derive a non-empty session title for image-only prompts |
| `src/runtime/persistence/history-reader.ts` | Preserve image prompts in replay |
| `src/runtime/persistence/telegram-media-ref-store.ts` | **New** — separate Telegram media-ref store using the same SQLite file as sessions |
| `src/frontend/tui/output.ts` | Render `[image: <path>]` for live/replayed user prompts and live outbound image events |
| `src/backend/adapters/claude.ts` | Build multimodal `ContentBlockParam[]` for inbound images and emit outbound `ImageEvent`s |
| `src/index.ts` | Instantiate `TelegramMediaRefStore` on the same SQLite file and pass persistence callbacks into the Telegram bot |

## Open Questions

1. **File size limits**: Telegram photos max out around 20 MB, and Claude vision input has payload limits too. The current implementation should still fail clearly if download or prompt construction exceeds limits.
2. **Albums / media groups**: Telegram media groups should become a single multimodal prompt, but batching by `media_group_id` is still deferred.
3. **Outbound replay**: Live outbound images work, but reconnect/session-switch replay still only reconstructs inbound multimodal prompts from Claude session history.
4. **GC policy**: The current no-wipe policy is safe but unbounded. If retention is added later, it must remove `telegram_media_refs` rows and files together.
5. **Non-image media**: Video, audio, documents, and generic file transfer need a separate event model and Telegram delivery strategy.
