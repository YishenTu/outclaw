<p align="center">
  <img src="assets/banner.png" alt="outclaw" width="800">
</p>

A mini [OpenClaw](https://github.com/openclaw/openclaw) rebuilt on the **Claude Agent SDK**, with **Codex app-server** layered in for Codex chat and coding sessions. No API keys, no per-token billing - just local Claude/Codex subscription.

Claude and Codex both run through the same provider-neutral runtime. The **skill system** extends the agent's abilities on top of that foundation.

Memory is file-first instead of transcript-first: each agent workspace is an [Obsidian](https://obsidian.md/)-ready vault of durable memory files routed through indexes and woven together with `[[wikilinks]]`. Obsidian CLI helps organize the files, while Outclaw's cron, heartbeat, and tools automate capture, curation, and synthesis.

Code mode acts as a Codex client, and Outclaw's remote-control layer makes that client available from anywhere. The delegation flow lets you shape the task with a chat agent first, then have it hand coding agent focused instructions.

Built-in CLI commands and scheduled task templates handle daemon management, agent workspaces, sessions, coding jobs delegation, and the **memory** system.

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
