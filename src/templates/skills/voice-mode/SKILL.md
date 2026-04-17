---
name: voice-mode
description: Transcribe a local audio file.
---

# voice-mode

Transcribe local audio files through the bundled helper script in this skill package.

## When To Use

- The user turn contains `[voice note (...): /abs/path/file.oga]`
- The user turn contains `[voice audio (...): /abs/path/file.mp3]`
- You have a local audio file path and need the transcript before you can answer

## Command

Run from your agent workspace root (e.g. `~/.outclaw/agents/<name>/`):

```bash
node ./skills/voice-mode/scripts/transcribe.mjs <path>
```

Optional flags:

```bash
node ./skills/voice-mode/scripts/transcribe.mjs <path> \
  --model gemini-3.1-flash-lite-preview \
  --language en \
  --prompt "Transcribe verbatim."
```

## Rules

1. Extract the absolute local file path from the prompt segment.
2. Run the helper from the agent workspace root with that path.
3. Respond to the user as if they had typed the transcript verbatim — never wrap it in quotes, never describe it.
4. If the helper exits non-zero:
   - Surface the stderr message to the user.
   - You may attempt **one** retry only if the error looks transient (HTTP 5xx, timeout, or `state: PROCESSING`). For 4xx, auth, or quota errors, stop.
   - Never invent a transcript when the helper failed.
5. If the helper succeeds but stdout is empty, reply: `I couldn't make out the voice note — can you resend or type it?`
6. Do not invent transcript content under any circumstance.

## Prerequisites

- `GEMINI_API_KEY` must already be present in the environment.
- `node` must be available on `PATH`.
