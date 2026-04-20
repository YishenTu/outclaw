# Agent Communication

## Overview

Agent-com lets one agent ask another agent a question through the runtime.

The caller invokes `oc agent ask` from inside its own workspace. The CLI resolves
the sender from `cwd/.agent-id`, opens a short-lived control websocket to the
daemon, and sends an ask request to the supervisor. The supervisor validates the
sender and target, forwards the message to the target agent runtime, and waits
for the target run to finish. The CLI prints the target agent's text reply to
stdout.

Sync and async are not separate commands. The calling agent decides by using the
Bash tool normally (sync/foreground) or with `run_in_background: true` (async).

This feature relies on the existing multi-agent runtime model:

- each agent already has its own long-lived runtime
- each runtime already has its own active session state
- each runtime serializes only its own queue
- different agent runtimes may work in parallel

So agent A can be mid-run in its own session while agent B continues processing
its own session. Agent-com adds cross-agent messaging on top of that isolation;
it does not require a shared global session or a single global execution lane.

## CLI Surface

```text
oc agent ask --to <target> [--timeout <seconds>] "<message>"
```

- `--to` — required target selector name
- `--timeout` — optional total wait time; omitted by default
- `<message>` — prompt text to deliver

The sender is not passed as a flag.

Sender resolution rules:

- the command must run inside an agent workspace containing `.agent-id`
- the CLI reads `.agent-id` from `cwd`
- the CLI resolves that durable `agent_id` back to the current selector name
- if resolution fails, the command exits 1 with a specific stderr error

If the command runs outside an agent workspace, it errors. There is no fallback
global sender inference.

Exit behavior:

- success -> exit 0, print response text to stdout
- validation / daemon / target error -> exit 1, print error to stderr
- explicit timeout expiry -> exit 124, print timeout message to stderr

## Control Client

`oc agent ask` does not connect as a normal interactive frontend client.

It uses a dedicated control client mode:

- websocket query param `client=control`
- no initial agent binding
- no `agent_switched` event
- no unsolicited `runtime_status`
- no history replay
- no TUI default-agent persistence

This keeps CLI ask traffic separate from interactive TUI / Telegram semantics.

## Message Flow

```text
Agent A (planner, Bash tool)
  │  oc agent ask --to scout "what's the weather?"
  ▼
CLI process
  │  resolves sender from cwd/.agent-id
  │  connects to daemon via WS as client=control
  │  sends ask request { fromAgentId, to, message }
  ▼
Supervisor
  │  validates sender agent exists
  │  validates target selector exists
  │  rejects self-calls
  │  resolves target runtime by selector name
  ▼
Target Agent Runtime (scout)
  │  wraps message with origin framing
  │  enqueues PromptExecution with source="agent"
  │  runs through the normal queue / prompt runner path
  ▼
SDK query (scout active session)
  │  processes prompt, runs tools, emits runtime events
  ▼
Target Agent Runtime
  │  concatenates emitted text chunks
  │  ignores thinking/status/image for CLI response
  │  returns ask_response when done arrives
  ▼
CLI process
  │  prints ask_response.text to stdout
  │  exits 0
  ▼
Agent A
  receives stdout as Bash tool result
```

## Target Agent Perspective

The target agent sees a normal prompt turn with origin framing injected by the
runtime:

```text
[from agent "planner"]
what's the weather?
```

The target does not need protocol awareness. Prompt handling remains a prompt
and skill concern, not a runtime-only behavior branch.

## Session And Delivery Semantics

The message enters the target agent's active session. If the target has no
active session, a new one is created.

Agent-com runs share the normal prompt execution path, but they are not treated
as TUI or Telegram turns.

Runtime must distinguish:

- prompt source: `tui`, `browser`, `telegram`, `heartbeat`, or `agent`
- delivery target / user-facing routing: the last user target for that agent,
  which can be the shared interactive target `{ kind: "tui" }` (covering both
  TUI and browser) or a Telegram chat

Rules:

- agent-com prompts run with `source="agent"`
- agent-com prompts do not rewrite the last user target for an existing session
- heartbeat delivery remains driven by dedicated delivery-target state, not by
  the most recent prompt source
- if an agent-com prompt creates a brand-new session, that session may be
  recorded as `source="agent"` and has no Telegram delivery target until a later
  Telegram turn establishes one

This prevents agent-originated turns from silently converting a Telegram-owned
session into a TUI-owned one.

## Sync vs Async

`oc agent ask` is always a blocking CLI call.

**Sync (foreground):**
The calling agent invokes `oc agent ask --to scout "question"` normally. The
Bash tool blocks until the response or timeout arrives.

**Async (background):**
The calling agent invokes the same command with `run_in_background: true`. The
SDK's background-task system handles wake-up and notification after the CLI
process exits.

## Busy Target Handling

If the target agent is already mid-turn, the ask request waits in the target
runtime's FIFO queue.

- no interruption
- no priority queue
- first-come, first-served

The caller's timeout applies to the total wait, including queue time.

## Timeouts And Nested Calls

Blocking asks wait until the target finishes unless the caller opts into
`--timeout`.

- timeout covers queue wait plus execution time
- when an explicit timeout expires, the CLI exits 124

If a timeout is provided, it bounds the caller wait only. A queued or
already-running target prompt may still complete after the caller disconnects.

Nested synchronous asks are therefore unsupported as a reliable composition
pattern. Without an explicit timeout, they may block indefinitely. If agent B
receives an agent-originated message and needs more work from agent C, it
should prefer background delegation.

## Permissions

No permission model for MVP. Any agent may contact any other agent.

Future: outbound `comms` allow-list per agent in `config.json`.

## Edge Cases

| Condition | Behavior |
|---|---|
| Command run outside an agent workspace | CLI exits 1, stderr: `cannot resolve sender agent from cwd` |
| Self-call (`sender == target`) | Supervisor rejects immediately, CLI exits 1 |
| Unknown sender agent id | Supervisor rejects immediately, CLI exits 1 |
| Unknown target selector | CLI exits 1, stderr: `agent "foo" not found` |
| Daemon not running | CLI exits 1, stderr: `daemon not running` |
| Target agent errors | CLI exits 1, stderr contains target error |
| Target has no active session | New session created, same as first prompt |
| Caller times out while target is queued or running | CLI exits 124; target run may continue for MVP |
| Nested sync ask chain (A->B->A or longer) | Not a reliable pattern; callers may block indefinitely unless they set `--timeout` |

## Protocol

### Websocket Client Type

```typescript
type RuntimeClientType = "tui" | "telegram" | "browser" | "control";
```

### Control Messages

```typescript
// Control client -> supervisor
type AskRequest = {
  type: "ask";
  fromAgentId: string;
  to: string;       // target selector name
  message: string;
};

// Supervisor -> control client
type AskResponse = {
  type: "ask_response";
  text: string;     // concatenated text chunks from the target run
};

type AskError = {
  type: "ask_error";
  message: string;
};
```

### Runtime Prompt Metadata

```typescript
type PromptSource = "tui" | "browser" | "telegram" | "heartbeat" | "agent";

type AgentPromptMetadata = {
  fromAgentId: string;
  fromAgentName: string;
};

type PromptExecution = {
  source: PromptSource;
  prompt: string;
  agentMessage?: AgentPromptMetadata;
  // existing fields omitted
};
```

The target runtime aggregates only emitted `text` events into the final
`ask_response.text`. `thinking`, `status`, `image`, and `done` are not surfaced
to the CLI response body.

## Boundary Rules

- `oc agent ask` command parsing and sender resolution live in `src/cli/`
- control-client connection handling and ask routing live in the supervisor
- self-call rejection and target resolution live in the supervisor
- message wrapping and `source="agent"` assignment live in the target runtime
- the target agent runtime uses the shared queue and prompt runner path
- heartbeat delivery routing must not depend only on the latest prompt source
- no new provider-specific SDK feature is required for the basic request path

## Bundled Prompt And Skill Conventions

The seeded workspace templates already reflect shipped agent-com behavior:

- `src/templates/AGENTS.md` documents `Agent message` as a first-class
  invocation mode and includes dedicated `Agent Management`,
  `Agent Communication`, and past-context lookup guidance
- `src/templates/skills/oc/SKILL.md` is the bundled operator skill for daemon
  control, agent lifecycle, config changes, session lookup, and `oc agent ask`
- `src/templates/skills/oc/references/agent-com.md` holds the concrete CLI
  guidance for cross-agent messaging

That keeps agent-com usage instructions bundled with each seeded agent
workspace instead of duplicating operational guidance inside runtime code.

## Non-Goals

- streaming the target's partial output back to the caller
- multi-agent broadcast or pub/sub
- agent-to-agent tool sharing
- bidirectional conversation in a single call
- permission model (deferred)
- cancellation of queued / running target asks after caller timeout
- `--new` session flag (deferred)
