# outclaw

A mini [OpenClaw](https://github.com/openclaw/openclaw) — autonomous AI agent powered by the Claude Agent SDK.

## Why

OpenClaw is powerful but bloated — most features go unused and reliability suffers. outclaw strips it down to what actually matters.

The key difference is the engine: outclaw runs on the **Claude Agent SDK** instead of Pi, so there is no API key or per-token billing — just a Claude subscription. 

The SDK handles the agent loop and built-in tools, **skill system** extends the agent's abilities on top of that foundation.

You don't need more than one personal assistant — one well-tailored agent is enough. In a multi-user setup, each user gets their own agent with isolated sessions, so context never leaks between people.

<!-- TODO: more on philosophy -->

## Features

- Terminal UI with markdown rendering, session picker, and multiline composer
- Telegram bot with the same capabilities, synced to the same runtime session
- Periodic heartbeat prompts injected into the active session
- Parallel cron jobs running independent agent instances on a schedule
- State-changing commands (model, effort, session) stay in sync across all connected frontends

<!-- TODO: more features -->

## Setup

```sh
git clone https://github.com/YishenTu/outclaw.git
cd outclaw
bun install
bun link
```

Run `oc start` or `oc dev` once to create `~/.outclaw/`.

Optional Telegram setup:

- Put Telegram settings in `~/.outclaw/config.json`
- Use literal values or `$ENV_VAR` references for `telegram.botToken`
- Use an array or a `$ENV_VAR` reference for `telegram.allowedUsers`
- Put those referenced env vars in the shell environment or in `~/.outclaw/.env`

## Stack

- [Bun](https://bun.sh) — runtime & package manager
- [@anthropic-ai/claude-agent-sdk](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) — agent backend
- [Ink](https://github.com/vadimdemedes/ink) — terminal UI
- [grammY](https://grammy.dev) — Telegram bot
- TypeScript (strict mode)

## License

MIT
