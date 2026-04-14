# Heartbeat

> **Status: Implemented (MVP).** This document describes the current MVP behavior and the next-step extension points.

## Overview

Heartbeat is a periodic internal prompt injected into the active session of a
specific agent runtime. The runtime enqueues a fixed wrapper prompt instead of
inlining that agent workspace's `HEARTBEAT.md` content. The wrapper is:

`Read HEARTBEAT.md and follow its instructions. Only act on what the file currently says — do not repeat tasks from earlier heartbeats or infer tasks from conversation history. If the file is missing or nothing needs attention, reply only \`HEARTBEAT_OK\`, no explaination.`

The file content is therefore not baked into the heartbeat prompt itself.

MVP scope:

- Heartbeat is owned by each agent runtime, not by a frontend.
- Heartbeat is always visible in TUI as a normal in-session turn.
- Heartbeat may additionally forward its final result to Telegram if the last
  user interaction for that agent was Telegram.
- Heartbeat uses the normal session and message queue.
- Heartbeat does not add a new public WebSocket/client message type.

## Ownership

Heartbeat is an agent-runtime subsystem.

- `src/index.ts` loads root config and passes heartbeat settings into each
  `createAgentRuntime()` call.
- `createAgentRuntime()` constructs and owns that agent runtime's heartbeat
  scheduler.
- `runtime.stop()` stops the scheduler together with the WebSocket server.
- The scheduler interacts with the runtime through an internal API, not through WebSocket messages.

This boundary matters because active-session state and prompt queueing already live in the runtime layer. `src/index.ts` should wire configuration, not coordinate session-aware prompt injection itself.

## Internal API

Heartbeat is not modeled as an external client prompt.

- The public `ClientMessage` protocol remains for real frontend traffic.
- The runtime exposes an internal enqueue path for prompts with runtime-only metadata such as `source: "heartbeat"`.
- `source: "heartbeat"` is reserved for runtime use. Official frontends do not send it over WebSocket in MVP.

The intended shape is conceptually:

```ts
interface InternalPrompt {
	prompt: string;
	source: "heartbeat";
}
```

This is an internal runtime concern, separate from the public transport contract.

Note: MVP does not add explicit server-side validation to reject raw external WebSocket clients that forge `source: "heartbeat"`. The guarantee is at the product/client layer, not as a hardened protocol boundary.

## Scheduler Semantics

Heartbeat is driven by a `setTimeout` chain (not `setInterval`). Startup schedules the first poll after `intervalMinutes`, and every subsequent poll schedules the next one unless the scheduler enters deferral.

The scheduler exposes `nextHeartbeatAt` (a Unix timestamp for when the next poll fires) and `deferred` (whether the heartbeat is waiting for user silence). `nextHeartbeatAt` is set whenever a normal poll is scheduled: on startup when `HEARTBEAT.md` has content, after a successful heartbeat, and after a `"skip"` result. It is cleared when heartbeat content disappears or the scheduler stops. During deferral, no retry timer is scheduled and `nextHeartbeatAt` is left unchanged until the deferred heartbeat fires or heartbeat content disappears.

### Normal tick flow

1. If `intervalMinutes` is `0`, do nothing.
2. If `HEARTBEAT.md` is missing or empty, clear state and schedule a retry at `intervalMinutes`.
3. If there is no active session or a heartbeat is already pending (`"skip"`), schedule next tick at `intervalMinutes`.
4. If `deferMinutes > 0` and the required silence window has not elapsed (`"defer"`), enter deferred state and notify the controller — see Deferral below.
5. Otherwise (`"attempt"`), build the wrapper prompt, enqueue the heartbeat, then schedule the next poll at `intervalMinutes`.

### Deferral

When a tick is deferred, the scheduler does **not** schedule a retry. Instead, it calls `onDeferred(deferMinutes)` and stops its timer. The controller takes over:

1. Controller starts a silence timer: `lastUserActivityAt + deferMinutes - now`.
2. If the user sends another prompt, the controller resets the silence timer to `deferMinutes` from now.
3. When the user has been quiet for `deferMinutes`, the silence timer fires and the controller calls `scheduler.fireDeferred()`.
4. `fireDeferred()` fires the heartbeat and resumes the `setTimeout` chain.

This is event-driven — no polling or periodic retry during deferral. The heartbeat fires as soon as the silence condition is met.

### Additional rules

- At most one heartbeat may be pending or in flight at a time.
- Any non-heartbeat user prompt updates the runtime's `lastUserActivityAt` timestamp.
- A queued heartbeat captures the activity timestamp at schedule time.
- When the queued heartbeat reaches the front of the queue, it re-checks the active session and activity timestamp before running.
- If user activity occurred after the heartbeat was scheduled, the queued heartbeat is stale and is dropped instead of running.

## HEARTBEAT.md Interpretation

MVP does not parse `HEARTBEAT.md` inside the runtime. The runtime sends the fixed wrapper prompt above, which tells the agent to:

- Read `HEARTBEAT.md`
- Only act on what the file currently says
- Avoid repeating tasks from earlier heartbeats
- Avoid inferring tasks from conversation history
- Reply only `HEARTBEAT_OK` when the file is missing or nothing needs attention

This keeps heartbeat scheduling deterministic while moving file interpretation to the agent.

## Visibility

Live behavior:

- TUI shows the injected heartbeat prompt as a user-style event labeled with `source: "heartbeat"`.
- TUI shows the heartbeat response live, using the same event flow as any other turn.
- TUI status bar shows a countdown to the next scheduled poll (e.g., `♥ 28m`, `♥ 1h15m`). During deferral, it shows `♥ defer` instead of a countdown.
- Telegram does not receive the live heartbeat stream.
- After the turn completes, runtime may additionally send the buffered final heartbeat result to the last remembered Telegram chat ID if Telegram is the current heartbeat delivery target.
- Telegram forwarding is best-effort only. If the Telegram send fails, the shared session and TUI heartbeat output remain unchanged.

The important boundary is that TUI visibility is not part of the Telegram delivery decision. Heartbeat is part of the shared session, so connected TUI clients see it live, and reconnecting TUI clients reconstruct it from normal session history replay.

## History Behavior

Heartbeat turns are normal turns in the shared active session.

- The prompt is sent through the same facade/session path as any other turn.
- The assistant response becomes part of normal session history.
- Replayed history includes heartbeat turns because they exist in the SDK-backed session transcript.

MVP does not add a separate local metadata store to preserve heartbeat labeling in replay. As a result:

- Live TUI can label heartbeat prompts distinctly.
- History replay may still render heartbeat prompts as ordinary user turns because the shared session transcript contains them.

That tradeoff is acceptable for MVP because it avoids inventing a parallel persistence system before the basic feature exists.

## Configuration

In root `~/.outclaw/config.json`:

```json
{
  "heartbeat": {
    "intervalMinutes": 30,
    "deferMinutes": 0
  }
}
```

- `intervalMinutes`: scheduler interval in minutes. `0` disables heartbeat entirely.
- `deferMinutes`: required silence window before a heartbeat may be scheduled. `0` means no silence gating.

Silence semantics:

- "User activity" means any non-heartbeat prompt from any frontend.
- Silence is tracked in memory only.
- No scheduler state is persisted across daemon restart.
- After daemon boot, the silence clock starts fresh in the new process.

## Lifecycle

- The runtime creates the heartbeat scheduler during startup.
- The scheduler starts on runtime startup.
- The first heartbeat attempt happens after the configured interval, not immediately.
- The scheduler is cleared during runtime shutdown.
- Daemon restart resets all in-memory heartbeat state.

## Edge Cases

- **`HEARTBEAT.md` missing or empty**: heartbeat is skipped entirely for that
  agent runtime. No countdown or defer indicator is shown. The scheduler keeps
  checking on each tick so heartbeat resumes automatically when the file
  reappears.
- **`HEARTBEAT.md` contains nothing that needs attention**: the wrapper prompt instructs the agent to reply only `HEARTBEAT_OK`.
- **No active session**: skip. Heartbeat never creates a session.
- **Daemon started with a previously persisted active session**: the session may be used, but silence/debounce state still starts fresh in the new process.
- **Agent already processing a prompt**: heartbeat waits in FIFO order unless later invalidated as stale.
- **User prompt arrives after heartbeat was queued**: the queued heartbeat is dropped when it reaches execution time.
- **User keeps talking during deferral**: the controller resets the silence timer on each prompt. The heartbeat fires only after the user has been quiet for the full `deferMinutes` window.

## Constraints

Heartbeat does not:

- Create sessions
- Run in a separate or parallel session
- Bypass the message queue
- Have its own system prompt
- Add a new public frontend protocol message
- Persist extra heartbeat-specific replay metadata in MVP

Heartbeat does use the same 4-file prompt assembly as normal prompts because it is just another turn in the same session.
