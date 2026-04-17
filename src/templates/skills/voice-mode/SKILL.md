---
name: voice-mode
description: Transcribe a local audio file.
---

# voice-mode

Transcribe a local audio file to text.

## When To Use

- The user turn contains `[audio: /abs/path/file.oga]`
- The user turn contains `[audio: /abs/path/file.mp3]`
- You have a local audio file path and need the transcript before you can answer

## Command

**Primary — call the `gemini` CLI directly** (free under the user's subscription):

```bash
gemini -m gemini-3.1-flash-lite-preview \
  --include-directories <PARENT_DIR_OF_AUDIO> \
  -p "Transcribe the audio verbatim. Output only the transcript, no commentary. @<ABSOLUTE_AUDIO_PATH>"
```

- `<PARENT_DIR_OF_AUDIO>` is the directory containing the audio file. It MUST be passed via `--include-directories` or the CLI's workspace sandbox will reject the path.
- `<ABSOLUTE_AUDIO_PATH>` must be the absolute path, prefixed with `@` inside the prompt string (bare paths are treated as literal text).
- Stdout is the transcript. Nothing else.

**Fallback — bundled helper script** (REST API, consumes `GEMINI_API_KEY`):

Only run this if the `gemini` CLI is missing or its invocation fails. From your agent workspace root:

```bash
node ./skills/voice-mode/scripts/transcribe.mjs <ABSOLUTE_AUDIO_PATH>
```

## Rules

1. Extract the absolute local file path from the prompt segment.
2. Try the primary `gemini` CLI invocation first.
3. Treat the captured stdout as the transcript. Respond to the user as if they had typed the transcript verbatim — never wrap it in quotes, never describe it.
4. If the primary call fails:
   - Surface the stderr message to the user.
   - Fall back once to the bundled helper script above.
   - If the fallback also fails, surface its stderr and stop. Never invent a transcript.
5. If the transcript is empty, reply: `I couldn't make out the audio message — can you resend or type it?`
6. Do not invent transcript content under any circumstance.

## Prerequisites

- **Preferred:** the `gemini` CLI (`@google/gemini-cli`) on `PATH`, authenticated via the user's subscription.
- **Fallback only:** `node` on `PATH` and `GEMINI_API_KEY` in the environment.
