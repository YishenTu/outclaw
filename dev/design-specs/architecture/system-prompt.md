# System Prompt

## Overview

The system prompt is assembled by each agent runtime from files in that
agent's workspace under `~/.outclaw/agents/<agent-name>/` and passed as a plain
string to the backend. The backend treats it as opaque — no parsing, no
structure awareness.

## Source Files

Four files, concatenated in order:

| File | Purpose | Changes when |
|------|---------|--------------|
| `AGENTS.md` | Behavioral rules and instructions | Features added or workflows evolve |
| `SOUL.md` | Personality, values, working style | Rarely (user tunes it once) |
| `USER.md` | Stable facts about the user | Rarely (user updates their profile) |
| `MEMORY.md` | Curated long-term memory index | Frequently (agent learns) |

### AGENTS.md — Instructions

Concrete operational rules. Contains interaction model (direct vs. scheduled), response formatting, memory principles and tier definitions, file access boundaries, action boundaries, and error handling rules.

The litmus test: if a different agent with a different personality would still follow the same rule, it belongs here.

### SOUL.md — Identity and Personality

Who the agent is. Identity metadata (name, avatar) at the top, followed by core values, communication personality, emotional register, and working style dispositions.

The litmus test: if swapping this file would change *who* the agent is but not *what* it does, it belongs here.

### USER.md — User Profile

Who the agent is talking to. Personal info, context, role, interests, preferences, and relationships. Stable facts that rarely change.

### MEMORY.md — Knowledge Index

Curated long-term memory — the distilled essence, not raw logs. Contains key facts and a unified index pointing to deeper files. Not instructions, not personality traits, not user profile data.

## Assembly

`readPromptFiles(promptHomeDir)` in `src/runtime/prompt/read-prompt-files.ts`:

1. Read each file in order.
2. Wrap each in an XML tag: `<agents>`, `<soul>`, `<user>`, `<memory>`.
3. Concatenate with blank-line separators.
4. Missing files are skipped silently (zero-config by default).

```
<agents>
[AGENTS.md contents]
</agents>

<soul>
[SOUL.md contents]
</soul>

<user>
[USER.md contents]
</user>

<memory>
[MEMORY.md contents]
</memory>
```

Assembly happens via `assembleSystemPrompt()` in `src/runtime/prompt/assemble-system-prompt.ts`, which delegates to `readPromptFiles()`. `PromptRunner` calls it before each `facade.run()` invocation.

## Current Scope

Current implementation only concatenates the four prompt files above from the
bound agent workspace. No additional per-invocation metadata is appended
programmatically, and the runtime does not read or manage any deeper memory
directories.

## Memory Architecture

Three tiers, from always-loaded to on-demand:

```text
~/.outclaw/agents/<agent-name>/
├── MEMORY.md              # tier 1: always in system prompt
├── daily-memories/        # optional convention space, not runtime-managed
│   ├── 2026-04-07.md
│   └── ...
└── notes/                 # optional convention space, not runtime-managed
    ├── projects.md
    └── ...
```

### Tier 1 — `MEMORY.md` (curated index)

Always injected into the system prompt. Must stay lean — only what's relevant across every session. Serves as an index pointing into deeper files.

### Tier 2 — `daily-memories/YYYY-MM-DD.md` (daily logs)

Raw capture of daily events. One file per day, if the agent or user chooses to use
this convention. Not in the system prompt — read on demand via tool use.

### Tier 3 — `notes/` (topic notes)

Deep knowledge on specific areas. Referenced from `MEMORY.md` if the prompt
convention uses it, then read on demand by the agent.

### Memory distillation

Memory is designed to flow upward through automated distillation at three cadences:

1. **Session reflection** (heartbeat) — At heartbeat intervals, reflect on the current session and write notable events to today's daily memory file.
2. **Daily distillation** (cron) — Scheduled job reviews today's daily memory and promotes important items to `MEMORY.md` or relevant `notes/` files.
3. **Persona evolution** (cron, weekly) — Scheduled job reviews the week's daily memories and decides whether `SOUL.md` should evolve.

Heartbeat and cron infrastructure are implemented. Whether any actual
distillation happens depends on the contents of `HEARTBEAT.md` and the cron
YAML prompts the user keeps in that agent workspace's `cron/` directory.

## Templates

Default templates for all four prompt files and `HEARTBEAT.md` live in
`src/templates/`. They are copied into a newly created agent workspace via
`seedTemplates()`. Existing files are never overwritten.

## Design Decisions

- **4 files, not more** — Clear separation: rules (AGENTS), personality (SOUL), user facts (USER), learned knowledge (MEMORY). No separate identity/persona/tools files.
- **Memory as index, not dump** — Only the index is in the prompt. Deeper files are read on demand. Keeps the context window lean.
- **User profile separate from memory** — USER.md is "who you are" (stable), MEMORY.md is "what you've learned" (accumulating). Different change rates justify separation.
- **Runtime assembles, backend receives** — Backend never reads prompt files. It gets a finished string.
- **Zero-config works** — Missing files are skipped. The agent functions without any prompt files configured.
