<p align="center">
  <img src="assets/banner.png" alt="outclaw" width="800">
</p>

A mini [OpenClaw](https://github.com/openclaw/openclaw) rebuilt on the **Claude Agent SDK**. No API keys, no per-token billing — just a Claude subscription.

The Claude Agent SDK handles the agent loop and built-in tools. **Skill system** extends the agent's abilities on top of that foundation.

Built in cli commands and schedule task templates handle internal management and **memory** system.

## Setup

```sh
git clone https://github.com/YishenTu/outclaw.git
cd outclaw
bun install
bun link
```

Then ask your agent to run `oc -h`.

## License

MIT
