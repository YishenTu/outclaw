# Daemon Operations

Use these commands when the user explicitly asks to control or inspect the outclaw runtime:

| Command | Purpose |
| --- | --- |
| `oc start` | Start the daemon in the background |
| `oc stop` | Stop the running daemon |
| `oc restart` | Restart the daemon |
| `oc status` | Check whether the daemon is running |
| `oc tui` | Connect the terminal UI to the running daemon |
| `oc tui --agent <name>` | Connect the terminal UI and bind it to a specific agent |
| `oc dev` | Run the daemon in the foreground for local development |

Guidance:

- Only run these commands when the user explicitly asks for daemon control or status.
- After significant config or prompt changes, suggest `oc restart` if the daemon needs to pick them up.
- `oc agent <name>` is a shortcut for `oc tui --agent <name>`.
