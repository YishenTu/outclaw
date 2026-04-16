<p align="center">
  <img src="assets/banner.png" alt="outclaw" width="800">
</p>

A mini [OpenClaw](https://github.com/openclaw/openclaw) rebuilt on the **Claude Agent SDK**. No API keys, no per-token billing — just a Claude subscription.

The Claude Agent SDK handles the agent loop and built-in tools. A **skill system** extends the agent's abilities on top of that foundation.

## Setup

```sh
git clone https://github.com/YishenTu/outclaw.git
cd outclaw
bun install
bun link
```

Then ask your agent to run `oc -h`.

## Stack

- [Bun](https://bun.sh) — runtime & package manager
- [@anthropic-ai/claude-agent-sdk](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) — agent backend
- [Ink](https://github.com/vadimdemedes/ink) — terminal UI
- [grammY](https://grammy.dev) — Telegram bot

## License

MIT
