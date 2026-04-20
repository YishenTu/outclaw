# Heartbeat

## Overview

Heartbeat is a periodic internal prompt injected into the active session of one
agent runtime.

It is not a public websocket feature and it does not create a separate session.

## Ownership

Heartbeat is runtime-owned:

- `src/index.ts` passes heartbeat config into each agent runtime
- `createAgentRuntime()` creates the scheduler
- the scheduler talks to runtime through internal callbacks
- frontends only render the resulting shared-session output

## Prompting Model

Heartbeat injects a fixed wrapper prompt that tells the agent to read
`HEARTBEAT.md`, act only on current instructions, summarize when they took any
action or have anything to report, and otherwise reply with exactly
`HEARTBEAT_OK` and no other text.

The runtime does not parse `HEARTBEAT.md` itself.

## Scheduler Semantics

`HeartbeatScheduler` is a `setTimeout` chain, not `setInterval`.

Normal behavior:

1. wait `intervalMinutes`
2. skip if heartbeat is disabled, missing, or empty
3. skip if there is no active session or a heartbeat should not run yet
4. defer if the silence window has not elapsed
5. otherwise enqueue a heartbeat prompt into the normal runtime flow

### Deferral

If `deferMinutes > 0` and recent user activity exists:

- scheduler marks itself deferred
- controller owns the silence timer
- further user prompts reset that silence timer
- agent-originated prompts do not reset that silence timer
- once the user has been quiet long enough, the controller calls
  `fireDeferred()`

This avoids polling during deferral.

## Session And Replay Semantics

- heartbeat runs use the normal active session
- heartbeat output is visible live in connected TUI/browser clients because it
  is normal runtime output
- replay reconstructs heartbeat turns from shared session history
- there is no separate persisted heartbeat metadata store

Live runtime can still label heartbeat-originated user prompts before they are
flattened into normal replay content.

## Telegram Delivery

Heartbeat output is always part of the shared session. In addition, the runtime
may forward the final buffered result to the agent's current
`last_user_target`.

Rules:

- only accepted user prompts mutate `last_user_target`
- accepted Telegram prompt -> `{ kind: "telegram", chatId }`
- accepted TUI prompt -> `{ kind: "tui" }`
- accepted browser prompt -> live `source="browser"`, persisted
  `{ kind: "tui" }`
- heartbeat and agent-originated prompts do not mutate it
- Telegram forwarding happens only when the current target is Telegram
- `HEARTBEAT_OK` stays suppressed for Telegram delivery

That forwarding is best-effort and does not affect the session itself.

## Config

Root `config.json`:

```json
{
	"heartbeat": {
		"intervalMinutes": 30,
		"deferMinutes": 0
	}
}
```

- `intervalMinutes: 0` disables heartbeat
- silence state is in-memory only
- daemon restart resets heartbeat timing state
- operator-side mutation of these globals is owned by
  `oc config runtime --heartbeat-interval ... --heartbeat-defer ...`
