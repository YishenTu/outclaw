# Agent Communication

## Command

| Command | Purpose |
| --- | --- |
| `oc agent ask --to <target> "<message>"` | Ask another agent a question and wait for a text response |
| `oc agent ask --to <target> --timeout <seconds> "<message>"` | Ask with a timeout; fails if the target takes too long |

The message can be passed as a quoted string or as bare words — all remaining positional arguments are joined with spaces.

## Guidance

- Run from inside an agent workspace (`~/.outclaw/agents/<name>/`) so `oc` can resolve the sender from `.agent-id`.
- `--to` targets the current agent selector name (not the durable agent id).
- This command blocks until a response arrives; there is no timeout unless you pass one.
- Pass `--timeout <seconds>` only when you want the request to fail after a bounded wait. On timeout the command exits with code 124.
- The ask enqueues a prompt into the target agent's existing active session. The message is prefixed with `[from agent "<sender>"]` so the target knows who is asking.
- If the target agent does not exist or cannot be reached, the command prints an error and exits with code 1.
- For async delegation inside agent runs, use the same command via the Bash tool with background execution.
