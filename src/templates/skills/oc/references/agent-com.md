# Agent Communication

## Command

| Command | Purpose |
| --- | --- |
| `oc agent ask --to <target> [--timeout <seconds>] "<message>"` | Ask another agent a question and wait for a text response |
| `oc agent send --to <target> "<message>"` | Send another agent a message without waiting for the result |

The message can be passed as a quoted string or as bare words — all remaining positional arguments are joined with spaces.

## Guidance

- Run from inside an agent workspace (`~/.outclaw/agents/<name>/`) so `oc` can resolve the sender from `.agent-id`.
- `--to` targets the current agent selector name (not the durable agent id).
- Use `ask` only when you need the peer's answer to decide your next move.
- Use `send` when you can continue without waiting for the peer's result.
- `ask` blocks until a response arrives; there is no timeout unless you pass one.
- `send` returns after the daemon accepts the message and does not wait for the target agent's result.
- Pass `--timeout <seconds>` only when you want the request to fail after a bounded wait. On timeout the command exits with code 124.
- Both commands enqueue a prompt into the target agent's existing active session. `ask` messages are prefixed with `[sync ask from agent "<sender>"]`; `send` messages are prefixed with `[async send from agent "<sender>"]`.
- If the target agent does not exist or cannot be reached, the command prints an error and exits with code 1.
- The daemon rejects calls that would form a peer-ask cycle (e.g. responding to a peer who is currently waiting on you). The error names the cycle (`A -> B -> A`) and instructs you to answer in your current response — the original ask is waiting for that output.
