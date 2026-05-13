# Coding Sessions

## Commands

| Command | Purpose |
| --- | --- |
| `oc coding <repo-id-or-path|provider/session> "<prompt>"` | Start or resume based on the target |
| `oc coding start <repo-id-or-path> "<prompt>"` | Start a daemon-owned coding session and print its ref |
| `oc coding resume <provider/session> "<prompt>"` | Send a follow-up prompt to an existing coding session |
| `oc coding monitor <provider/session>` | Replay prior progress and stream until terminal state |
| `oc coding status <provider/session>` | Print running, error, or the final response |

The prompt can be passed as a quoted string or as bare words. All remaining
positional arguments after the repo/path or session ref are joined with spaces.

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
- If the session is already running, `resume` fails instead of queueing another turn into the same coding session.
- Use `monitor` when the user needs progress or evidence. It replays normalized prior events, streams new normalized events, blocks until the observed turn reaches `done` or `error`, and relies on the caller's shell/tool timeout for interruption.
- Use `status` when you need a non-streaming snapshot. It prints `running` while the latest turn is active, `error: <message>` for failed turns, or `done` plus the final assistant response when the session is idle.
