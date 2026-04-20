# Prompting

## Scope

This document owns prompt-file assembly and workspace prompt conventions.

It does not own provider execution behavior or scheduler timing.

## System Prompt Assembly

Each runtime assembles a plain system prompt string from files in the bound
agent workspace:

- `AGENTS.md`
- `SOUL.md`
- `USER.md`
- `MEMORY.md`

`readPromptFiles(promptHomeDir)` reads these files in that order, wraps them in
tags, and skips any missing file silently.

```text
<agents>...</agents>
<soul>...</soul>
<user>...</user>
<memory>...</memory>
```

`assembleSystemPrompt()` is the runtime entry point. Backend receives the final
string as opaque input.

`assembleSystemPrompt()` caches the assembled prompt per prompt-home directory
and invalidates that cache when any of the four core prompt files changes mtime.

## Ownership Split

- runtime owns prompt file reading and assembly
- backend owns how the assembled string is passed to the provider
- agent management owns initial template seeding

Backend must not read prompt files from disk by itself.

## Workspace Conventions

Seeded at agent creation:

```text
~/.outclaw/agents/<name>/
  AGENTS.md
  SOUL.md
  USER.md
  MEMORY.md
  HEARTBEAT.md
  cron/
  skills/
```

Optional/lazy-created working directories:

- `daily-memories/`
- `notes/`

Only the four core prompt files are always loaded into the system prompt.
`notes/`, `daily-memories/`, and `cron/` are workspace conventions and are read
only when a tool or scheduler flow explicitly needs them.

## Heartbeat Prompting

Heartbeat does not inline `HEARTBEAT.md` into the assembled system prompt.

Instead, heartbeat runs inject a fixed wrapper prompt telling the agent to read
`HEARTBEAT.md`, act only on current instructions, summarize when they took any
action or have anything to report, and otherwise reply with exactly
`HEARTBEAT_OK` and no other text.

This keeps heartbeat interpretation agent-owned while scheduler timing stays
runtime-owned.

## Templates

Templates live under `src/templates/` and are seeded on agent creation:

- core prompt files
- `HEARTBEAT.md`
- cron templates
- bundled skills: `oc`, `actionbook`, `skill-creator`, and `voice-mode`

Existing user files are not overwritten on later runs.
