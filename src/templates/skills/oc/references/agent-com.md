# Agent Communication

## Command

| Command | Purpose |
| --- | --- |
| `oc agent ask --to <target> "<message>"` | Ask another agent a question and wait for a text response |
| `oc agent ask --to <target> --timeout <seconds> "<message>"` | Ask another agent a question and fail if it takes longer than the provided timeout |

## Guidance

- Run from inside an agent workspace (`~/.outclaw/agents/<name>/`) so `oc` can resolve the sender from `.agent-id`.
- `--to` targets the current agent selector name (not the durable agent id).
- This command blocks until a response arrives; there is no timeout unless you pass one.
- Pass `--timeout <seconds>` only when you want the request to fail after a bounded wait.
- For async delegation inside agent runs, use the same command via the Bash tool with background execution.
