# Session Rollover

This document defines the shipped agent-idle session rollover behavior. It
extends runtime-owned session lifecycle policy without changing the persisted
chat-session model or user-facing `/session` recovery flow.

## Overview

Session rollover exists to stop one agent from carrying the same default active
session forever after long interactive silence.

When the configured idle window elapses, the runtime:

1. mark the current idle epoch handled
2. detach the active-session pointer immediately
3. store a one-time notice explaining what happened
4. run one final prompt against the old session in the background
5. keep the old session resumable through `/session`

Rollover does not delete, compact, or rewrite the old session. It only ends the
current default active session's status as the default target for new prompts.

## Why This Is Not Heartbeat

Heartbeat is in-session housekeeping. It never changes which session is active.

Rollover is different:

- it is a runtime lifecycle policy
- it mutates the persisted active-session pointer
- it intentionally creates a boundary between the old topic and the next prompt

So rollover must not be modeled as "just another heartbeat."

## Ownership

Rollover is a cross-layer feature with clear boundaries:

- runtime owns idle tracking, rollover scheduling, prompt enqueue, detach policy, and persisted state
- frontend owns rendering the one-time rollover notice
- backend/provider owns normal run/resume semantics for the rollover prompt

The provider adapter must not gain provider-specific rollover behavior. Runtime remains responsible for deciding when rollover starts and what session state changes after it finishes.

## Idle Definition

Idle time is measured from the last accepted interactive user prompt for the
agent.

Accepted sources:

- `tui`
- `browser`
- `telegram`

Excluded sources:

- `heartbeat`
- `agent`
- cron
- assistant output
- websocket connects/disconnects
- `/status` or other control-only commands

Rules:

- any accepted interactive user prompt resets the agent idle timer
- switching sessions does not reset the agent idle timer
- the idle timer is not bound to a specific session
- when rollover executes, it applies to whichever chat session is active at
  that moment
- if no chat session is active when rollover executes, rollover is skipped

## Persistence

Rollover persists both its idle reference point and its once-per-idle-epoch
guard state:

- `last_interactive_at:{agent_id}`
- `last_handled_rollover_interactive_at:{agent_id}`
- `rollover_notice:{agent_id}`

Daemon restart must not reset an idle agent back to "fresh" or allow the same
idle epoch to trigger rollover twice.

Purely in-memory silence tracking is insufficient for rollover. Heartbeat may
keep in-memory silence state, but rollover must survive daemon restarts.

## Config

Rollover is configured per agent under that agent's existing config in root
`config.json`.

```json
{
	"agents": {
		"agent-railly": {
			"rollover": {
				"idleMinutes": 480
			}
		}
	}
}
```

Rules:

- `idleMinutes: 480` is the default shipped value (`8h`) when the agent does
  not override it
- `idleMinutes: 0` disables rollover for that agent
- only idle-based rollover is shipped
- fixed wall-clock rollover such as "8:00 AM every day" is out of scope for the
  current implementation
- this setting is agent-scoped, not runtime-global
- it belongs under `agents.{agent_id}`, not the top-level runtime config block

Config ownership:

- runtime reads the resolved rollover setting for the bound agent runtime
- root runtime config must not gain a global `rollover` block
- agent-scoped config mutation belongs with other per-agent config flows, not
  `oc config runtime`

## Trigger Conditions

Rollover may start only when all of the following are true:

1. rollover is enabled for the current agent
2. the persisted agent idle window has elapsed
3. an active chat session exists at execution time
4. no run is currently active
5. the runtime does not already have a queued or active rollover attempt

Here "active" means the currently visible session lane. Hidden background runs
in other sessions do not block rollover for the still-active session.

If a fresh interactive user prompt is accepted before rollover runs, rollover is
canceled and the agent idle timer resets.

## Prompting Model

Rollover uses a dedicated wrapper prompt. It must not reuse heartbeat source or
heartbeat wrapper text.

Intent:

- tell the agent the runtime is auto-finalizing the currently active session
  because the agent has been idle
- ask for one final check against today's daily memory
- summarize only if something changed or needs to be reported
- otherwise reply with exactly `ROLLOVER_OK`

The runtime still does not parse daily notes itself.

### Why Rollover Needs Its Own Source

Exact heartbeat wrapper prompts and bare `HEARTBEAT_OK` replies are hidden from
transcript search.

Rollover is a meaningful session boundary and should stay visible for debugging,
replay, and future session lookup. It therefore needs its own prompt source and
label instead of piggybacking on heartbeat.

## Session Mutation Semantics

The rollover prompt runs inside whichever chat session is active when rollover
executes, using normal provider resume semantics.

When the rollover attempt starts, runtime immediately clears only the
active-session pointer. The rollover finalize prompt then continues against the
previous session in the background.

It does not:

- delete the old session
- create a new provider session immediately
- switch the user into some other old session
- rewrite session history

The next interactive prompt starts a fresh session naturally because no active
session is selected anymore, unless the user explicitly switches to an existing
session first. That new prompt does not wait for the rollover finalize turn to
finish.

## Failure Policy

Detach is not conditional on rollover success.

Current behavior:

- attempt rollover prompt once
- clear the active-session pointer at rollover start, before the finalize prompt
  completes
- include failure information in the user notice when the final check failed

If detach depended on success, one broken rollover turn could keep an old
default session attached forever.

## Notice Semantics

After rollover detaches the active session, runtime surfaces a one-time notice
to interactive frontends for that agent.

Current copy:

```text
Previous session auto-finalized after <configured idle window>. Use /session to resume.
```

If the rollover prompt failed:

```text
Previous session auto-finalized after <configured idle window>. Final check failed. Use /session to resume.
```

For the default configuration, that window is `8h`.

Rules:

- notice is agent-scoped, not process-global
- notice is emitted through `runtime_status.notice` as
  `{ kind: "rollover", message }`
- notice is written only when rollover actually starts, not merely when the
  idle window becomes overdue
- notice survives reconnects until the next accepted interactive prompt
- notice clears after the next accepted interactive prompt
- notice informs, but does not force immediate user action

## Frontend Behavior

### TUI

- show the rollover notice in the same status/notice area used for runtime notices
- do not inject the notice into provider transcript history
- next prompt submission should behave like a fresh session start unless the user explicitly switched sessions first

### Browser

- show the same one-time rollover notice in the left-sidebar notification stack
- keep the previous session selectable in the left sidebar session list
- current browser UX lets the user dismiss the rollover notice manually and
  also auto-hides it after `5s`; `restart_required` remains
  persistent
- next prompt submission should start fresh unless the user explicitly selects a session first

### Telegram

Shipped behavior does not proactively deliver rollover notices to Telegram.

If the user later sends a message from Telegram while no active session is
selected, that message simply starts a fresh session. Any Telegram notice
behavior beyond that is follow-up work.

## Search And Replay

Rollover turns are part of the old session history and should replay with that
session.

Unlike operational heartbeat plumbing, rollover wrapper prompts and substantive
rollover results should remain searchable. The boundary is meaningful session
metadata, not hidden maintenance noise.

Current search indexing does not apply heartbeat-style filtering to rollover.
The rollover wrapper prompt, the `ROLLOVER_OK` no-op reply, and substantive
rollover output all remain searchable and replayable.

## Ordering Guards

Current ordering rules:

- if a user prompt is accepted before rollover starts, rollover is canceled and
  the idle timer resets
- if the active session changes before rollover starts, rollover still applies
  to the newly active session
- if no active session exists when rollover starts, rollover is skipped
- at most one rollover attempt may be pending or active per agent runtime
- once rollover starts, the active-session pointer is already detached even
  while the finalize turn is still running in the old session lane
- a new interactive prompt accepted after rollover starts may begin a fresh
  session while the old session finalize turn continues in the background
- hidden background runs in other sessions may continue while rollover remains
  gated by the currently visible active session lane

The important correctness rule is visible-session lifecycle ordering, not
global per-agent serialization.

## Non-Goals

- Fixed-time daily rollover such as `8:00 AM`
- Automatic creation of a brand-new provider session at rollover time
- Deleting or archiving old sessions
- Cross-agent or global rollover state
- Reusing heartbeat prompt/source/labels for rollover
- Forcing the user back into the previous session automatically
