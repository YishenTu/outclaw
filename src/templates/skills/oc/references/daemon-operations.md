# Daemon Operations

Use these commands when the user explicitly asks to control or inspect the outclaw runtime:

| Command | Purpose |
| --- | --- |
| `oc start [--lan] [--host HOST]` | Start the daemon in the background, optionally updating the bind host first |
| `oc stop` | Stop the running daemon |
| `oc restart [--lan] [--host HOST]` | Restart the daemon, optionally updating the bind host first |
| `oc status` | Check whether the daemon is running |
| `oc build` | Rebuild the production browser bundle |
| `oc tui` | Connect the terminal UI to the running daemon |
| `oc tui --agent <name>` | Connect the terminal UI and bind it to a specific agent |
| `oc tui --watch` | Connect the TUI in watch mode (restarts on file changes) |
| `oc dev` | Run the daemon in the foreground for local development |

Guidance:

- First run: `oc build && oc start`
- Browser from another machine on a trusted LAN: `oc start --lan`
- After browser source changes: `oc build && oc restart`
- Only run these commands when the user explicitly asks for daemon control or status.
- `oc start` auto-builds the browser bundle only when `src/frontend/browser/dist/` is missing.
- If browser source changed and the production browser bundle needs to be refreshed, use `oc build` and then `oc restart`.
- `oc start` and `oc restart` default to `127.0.0.1`, so browser access stays on the current machine unless the host is changed.
- Use `oc start --lan` or `oc restart --lan` when the user wants browser access from another machine on the LAN. This persists `host: "0.0.0.0"` into `~/.outclaw/config.json`.
- Use `oc start --host HOST` or `oc restart --host HOST` when the user wants an explicit bind host persisted into config before launching.
- If `oc agent ...`, `oc config runtime`, or `oc config secure` surfaces a restart-required notice, use `oc restart` when the user wants the running daemon to pick up those changes.
- `oc agent <name>` is a shortcut for `oc tui --agent <name>`.
- `--watch` and `--agent` can be combined: `oc tui --agent <name> --watch`.
- Use `oc start -h` or `oc restart -h` for the current help text and examples.
