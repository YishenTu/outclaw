# Coding Sessions

## Commands

| Command | Purpose |
| --- | --- |
| `oc coding <repo-id-or-path|provider/session> "<prompt>"` | Start or resume based on the target |
| `oc coding start <repo-id-or-path> "<prompt>"` | Start a daemon-owned coding session and print its ref |
| `oc coding resume <provider/session> "<prompt>"` | Send a follow-up prompt to an existing coding session |
| `oc coding status <provider/session>` | Print running, error, or the final response |
| `oc coding transcript <provider/session> [--turns N|--full]` | Replay normalized coding-session history |

The prompt can be passed as a quoted string or as bare words. All remaining
positional arguments after the repo/path or session ref are joined with spaces.
Prefer quoted strings when the prompt contains shell-significant characters
such as `$`, `!`, quotes, or globs.

## Guidance

- Prefer the short form when the target is clear.
- Use `start` explicitly when you want to force repository/path start semantics.
- Pass a local repo path when you know the workspace. Pass a registered repository id only when you have one.
- `start` waits only until the provider session is initialized. It does not stream the full coding turn.
- Save the printed `provider/session` ref. Use that exact ref for later follow-up work.
- Use the printed `provider/session` ref when the user asks you to check on, refine, or continue work in an existing coding session.
- Use `resume` explicitly when you want to force existing-session semantics.
- `resume` waits only until the daemon accepts the follow-up turn. It does not stream the result inline.
- Archived sessions are restored by the daemon resume path before the prompt is accepted.
- If the session is already running, `resume` steers the active turn instead of queueing another turn into the same coding session.
- Use `status` when you need a non-streaming snapshot. It prints `running` while the latest turn is active, `error: <message>` for failed turns, or `done` plus the final assistant response when the session is idle. For polling, read only the first output line.
- Use `transcript` when you need history or evidence. It replays normalized prior events without following future output. By default it prints the latest interaction turn; use `--turns N` to inspect the latest N interaction turns and `--full` only for intentional full replay.
- A transcript interaction turn starts at the first `[user]` after the previous `[done]` or `[error]` and includes any later steering `[user]` prompts until the next terminal event.
- `status` and `transcript` exit 0 on successful lookup and 1 on usage, daemon, or session lookup failures.

## Gotchas

- The CLI resolves path targets to absolute coding-session cwd values. It does not intentionally change the caller shell's directory, but some agent shells may report their command cwd being reset after `oc coding start`; use explicit command cwd or `cd <repo> && ...` in follow-up shell commands instead of relying on implicit cwd.
