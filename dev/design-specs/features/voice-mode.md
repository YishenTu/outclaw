# Voice Mode

## Overview

Voice mode lets a Telegram user send a voice note or audio upload and have the
agent process it as a normal turn after transcribing the local audio file.

The boundary stays provider-neutral:

- Telegram downloads the audio into managed `files/` storage.
- Telegram stores a reply-reusable file ref with `kind: "voice"`.
- Telegram converts that ref into a prompt segment such as
  `[voice note (oga, 12s): /abs/path/file.oga]`.
- The bundled `voice-mode` skill tells the agent to prefer the local `gemini`
  CLI and fall back once to the bundled helper script when needed.
- Only the skill/tooling boundary talks to Gemini. Runtime and Telegram
  frontend code stay free of Gemini SDK/API coupling.

There is no `src/common/protocol.ts` change for voice. Voice attachments are
flattened into prompt text before crossing the runtime websocket boundary.

## Ownership

- `src/frontend/telegram/messages/voice.ts` owns Telegram `message:voice` and
  `message:audio` ingestion.
- `src/frontend/telegram/files/message-file-ref.ts` owns voice prompt-segment
  formatting and reply reuse.
- `src/runtime/persistence/telegram-file-ref-store.ts` owns durable voice file
  refs in SQLite.
- `src/templates/skills/voice-mode/SKILL.md` owns the preferred `gemini` CLI
  invocation and fallback rules.
- `src/templates/skills/voice-mode/scripts/` own the bundled REST fallback and
  Gemini HTTP calls.
- `src/runtime/` does not participate beyond normal prompt execution.

## Telegram Flow

The shipped flow is:

1. Accept `message:voice` or `message:audio`.
2. Reject non-audio mime types and files larger than 20 MB.
3. Download the Telegram file into managed `files/YYYY/MM/DD/...`.
4. Persist the inbound file ref as `kind: "voice"` with optional `mimeType`
   and `durationSeconds`.
5. Resolve any replied-to image/document/voice attachment.
6. Build the prompt from:
   - the message caption, when present
   - reply-derived prompt segments
   - a new `[voice note ...]` or `[voice audio ...]` segment for the uploaded
     file
7. Stream the combined prompt through the existing Telegram prompt path.

`message:voice` defaults to `.oga`. `message:audio` chooses the extension from
mime type, file name, or Telegram file path when possible.

## Skill Package

The bundled skill lives under `src/templates/skills/voice-mode/` and is seeded
into new agent workspaces alongside the other shipped skills.

The shipped skill path is:

1. Preferred: use the local `gemini` CLI against the downloaded file
2. Fallback: run the bundled helper script once if the CLI is unavailable or
   fails

Preferred command shape:

```bash
gemini -m gemini-3.1-flash-lite-preview \
  --include-directories <parent-dir> \
  -p "Transcribe the audio verbatim. Output only the transcript, no commentary. @<absolute-audio-path>"
```

Fallback helper command:

```bash
node ./skills/voice-mode/scripts/transcribe.mjs <path> \
  [--model <id>] \
  [--language <code>] \
  [--prompt <instr>] \
  [--max-bytes <n>] \
  [--timeout-ms <n>] \
  [--no-delete]
```

Current behavior:

- default model: `gemini-3.1-flash-lite-preview`
- default prompt: verbatim transcript, no commentary, no timestamps, speaker
  labels only when multiple speakers are clearly present
- preferred path requires the user's authenticated `gemini` CLI
- fallback helper requires `GEMINI_API_KEY` from process env
- writes transcript text to stdout only
- writes errors to stderr
- exits `0` on success, `2` for auth/env failures, `3` for unsupported media,
  `4` for timeout/upload timeout, otherwise `1`
- uploads through Gemini Files API using resumable upload
- polls the uploaded file until `ACTIVE`
- retries `generateContent` on 5xx failures with backoff `1s`, then `3s`
- deletes the uploaded Gemini file after completion unless `--no-delete` is set

The helper uses `fetch` directly and rejects redirects outside
`*.googleapis.com`.

## Storage

Voice refs are stored in `telegram_file_refs` with:

- `kind = "voice"`
- `path`
- `media_type` reused for optional `mimeType`
- `duration_seconds` for optional `durationSeconds`
- `display_name` unused for voice refs

Schema migration is additive: if `duration_seconds` is missing, the store adds
it with `ALTER TABLE ... ADD COLUMN duration_seconds INTEGER`.

## Failure Modes

| Failure | Behavior |
|---|---|
| Voice note larger than 20 MB | Telegram replies `[error] voice note too large (20 MB limit)` and drops the turn. |
| Non-audio mime type | Telegram replies `[error] unsupported voice format: <mime>`. |
| `gemini` CLI missing or failing | Skill surfaces the primary error and falls back once to the bundled helper. |
| `GEMINI_API_KEY` missing | Fallback helper exits `2`; the agent surfaces the stderr text. |
| Upload or transcription timeout | Fallback helper exits `4`; the agent surfaces the stderr text. |
| Gemini rejects uploaded audio | Fallback helper exits `3` when classified as unsupported media. |
| Gemini returns empty transcript | Skill tells the agent to reply `I couldn't make out the voice note — can you resend or type it?` |

## Current Coverage

- `test/frontend/telegram/messages/voice.test.ts`
- `test/frontend/telegram/files/message-file-ref.test.ts`
- `test/runtime/persistence/telegram-file-ref-store.test.ts`
- `test/runtime/prompt/seed-templates.test.ts`

There is currently no dedicated unit-test file for the bundled `gemini` CLI
prompting path or the helper scripts under `src/templates/skills/voice-mode/scripts/`.
