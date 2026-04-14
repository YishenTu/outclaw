---
name: outclaw-guide
description: Help users set up and operate outclaw agents, Telegram onboarding, sessions, skills, cron, heartbeat, and core CLI workflows.
---

# Outclaw Guide

Use this skill when the user asks how to set up, operate, or customize outclaw.

## Agent Setup

When guiding a user through creating an agent:

1. Explain that `oc agent create <name>` creates a new agent workspace under `~/.outclaw/agents/<name>/`.
2. If they need a Telegram bot token, tell them to talk to `@BotFather` in Telegram and create a bot there.
3. If they need their Telegram user ID, tell them to message their outclaw bot with `/start`. The bot replies with their numeric Telegram user ID.
4. Explain the non-interactive form when useful:

```bash
oc agent create <name> --bot-token <token> --users <telegram-user-id>[,<telegram-user-id>...]
```

5. Remind them that `config.json` in `~/.outclaw/` is shared infra, while `.agent-id` is the durable per-agent owner key.

## CLI Reference

Use these commands when answering operational questions:

```text
oc start
oc stop
oc restart
oc status
oc tui
oc tui --agent <name>
oc agent list
oc agent create <name>
oc agent rename <old> <new>
oc agent remove <name>
oc agent <name>
```

- `oc agent <name>` is a shortcut for opening the TUI and binding it to that agent.
- `/agent` and `/agent <name>` switch agent context inside a running session.

## Working Files

Explain these files as the main agent prompt surface:

- `AGENTS.md`: operating rules and collaboration constraints
- `SOUL.md`: identity and long-term character
- `USER.md`: user-specific preferences and context
- `MEMORY.md`: durable memory index
- `HEARTBEAT.md`: autonomous maintenance instructions
- `notes/`: reference notes
- `daily-memories/`: dated working memory summaries
- `cron/`: autonomous scheduled jobs
- `skills/`: installable per-agent skills

Each agent runs with its own cwd at `~/.outclaw/agents/<name>/`, so relative file access resolves inside that agent directory.

## Sessions

When asked about sessions:

- `/session` opens the session menu
- `/session list` lists recent chat sessions
- `/session <id-or-prefix>` switches to a chat session
- `/session delete <id-or-prefix>` deletes a chat session
- `/session rename <id-or-prefix> <title>` renames a chat session

Cron runs are stored separately with `tag = cron` and are not normal chat sessions.

## Skills, Cron, Heartbeat

When asked about autonomous behavior:

- Skills live under `skills/<skill-name>/SKILL.md`
- Cron jobs live under `cron/*.yaml`
- Heartbeat behavior is controlled by `HEARTBEAT.md` plus runtime heartbeat config

Use `oc start` after significant config or prompt changes when the daemon needs to pick them up.

## Response Style

- Be concrete about file paths and commands.
- Prefer exact commands over abstract advice.
- If a user is blocked on Telegram setup, walk them through BotFather and `/start` user ID discovery step by step.
