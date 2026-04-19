# Config Management

## Commands

| Command | Purpose |
| --- | --- |
| `oc config runtime [--host HOST] [--port N] [--auto-compact true|false] [--heartbeat-interval N] [--heartbeat-defer N]` | Update restart-bound runtime globals in `~/.outclaw/config.json` |
| `oc config secure` | Move hardcoded per-agent Telegram secrets/selectors from `config.json` into `~/.outclaw/.env` |

## Guidance

- Use `oc config -h` or `oc config runtime -h` for the current flag syntax.
- Use `oc config runtime` when the user wants to change daemon-level config through the CLI instead of editing `config.json` by hand.
- `oc config runtime` owns only runtime globals: `host`, `port`, `autoCompact`, and `heartbeat`.
- `oc config runtime` creates `~/.outclaw/config.json` if it does not exist yet and preserves unknown top-level keys plus per-agent config under `agents`.
- `--port 0` is valid for ephemeral-port development workflows.
- For remote browser access on a trusted LAN, `--host 0.0.0.0` is the persisted bind setting.
- If the user wants to both change host and immediately apply it, prefer `oc start --lan`, `oc restart --lan`, `oc start --host HOST`, or `oc restart --host HOST` over a separate config-only step.
- Use `oc config secure` when the user hardcoded Telegram bot tokens or allowed-user selectors in `config.json` and wants them moved into env vars.
- Do not use `oc config runtime` for per-agent Telegram settings. Those stay on `oc agent create|config`.

## Runtime Note

- Neither `oc config runtime` nor `oc config secure` restarts the daemon automatically.
- If the daemon is already running, these commands surface a restart-required notice.
- Tell the user `oc restart` is still required when they want the running runtime to pick up the change.
