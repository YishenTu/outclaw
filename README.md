# misanthropic

A mini [OpenClaw](https://github.com/openclaw/openclaw) — autonomous AI agent powered by the Claude Agent SDK.

## Architecture

- **Runtime** — Orchestrates agent lifecycle, sessions, and message routing
- **Backend** — HTTP/WebSocket server exposing the runtime
- **Frontend** — Optional browser UI and TUI
- **Tools** — Custom MCP tools available to the agent

## Stack

- [Bun](https://bun.sh) — runtime & package manager
- [@anthropic-ai/claude-agent-sdk](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) — agent backend
- [Hono](https://hono.dev) — HTTP framework
- [Zod](https://zod.dev) — validation & tool schemas
- TypeScript (strict mode)

## Setup

```sh
bun install
cp .env.example .env  # add your ANTHROPIC_API_KEY
```

## License

MIT
