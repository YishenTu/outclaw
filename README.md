# misanthropic

A mini [OpenClaw](https://github.com/openclaw/openclaw) — autonomous AI agent powered by the Claude Agent SDK.

## Architecture

- **Runtime** — WS server, session management, message queue, daemon lifecycle
- **Backend** — Facade interface with Claude Agent SDK adapter
- **Frontend** — Ink TUI and Telegram bot
- **Common** — Shared protocol types and helpers

## Stack

- [Bun](https://bun.sh) — runtime & package manager
- [@anthropic-ai/claude-agent-sdk](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) — agent backend
- [Ink](https://github.com/vadimdemedes/ink) — terminal UI
- [grammY](https://grammy.dev) — Telegram bot
- TypeScript (strict mode)

## Setup

```sh
bun install
bun link               # makes 'ma' command available globally
cp .env.example .env   # add TELEGRAM_BOT_TOKEN (optional)
```

## Usage

```sh
ma start     # start daemon (background)
ma tui       # connect TUI
ma stop      # stop daemon
ma status    # check if running
ma dev       # foreground with hot reload
```

## License

MIT
