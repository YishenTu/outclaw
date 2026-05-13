# Coding Agent

## Purpose

Outclaw needs a first-class coding tool/session service. The coding tool should
work in a repo `cwd`, be invokable from a normal chat agent, support parallel
code sessions, and expose code-specific browser/TUI/CLI workflows without
turning coding concepts into normal chat-agent identity.

Codex app-server is the first coding provider, but Codex must remain a reusable
backend adapter. A future normal Codex chat agent should be able to use the same
adapter without going through `runtime/coding/`.

## Goals

- Use Codex app-server with Codex default coding instructions.
- Let chat agents delegate a prompt to a cwd-bound coding session.
- Link each coding session back to the invoking chat session when available.
- Support multiple parallel coding sessions.
- Persist coding sessions as first-class sessions with coding-specific metadata.
- Maintain a first-class repo list for user-visible coding projects.
- Group coding sessions under projects in browser code navigation.
- Let users start coding sessions directly from a registered repo.
- Let users manually add an existing repo or clone a new repo into the list.
- Keep start and resume commands one-off without streaming turn output inline:
  start waits until provider session identity is known, while resume validates
  an existing session ref and returns that same ref after accepting the turn.
- Add an explicit monitor command for replaying and following coding-session
  progress.
- Add browser code-session UX beside chat tabs.
- Bind browser file/git/terminal panels to the focused coding session cwd.
- Add TUI code-session switching separate from normal chat `/session`.
- Render tools, approvals, command output, patches, usage, and transcripts.

## Non-Goals For The MVP

- Do not make Telegram code-session switching part of the first UI slice.
- Do not start one Codex app-server process per coding session unless measured
  isolation or lifecycle evidence requires it.
- Do not place Codex-specific protocol parsing or filesystem layout in
  `src/runtime/`.
- Do not make normal chat runtime APIs carry coding-tool concepts unless the
  behavior is a reusable provider-neutral mechanic.
- Do not make the repo list a generic project-management system outside the
  coding-tool workflow.
- Do not make coding-session monitoring read Codex-native stdout, log files, or
  transcript formats directly.
- Do not model the coding tool as a peer chat agent with its own persona,
  routing identity, or `.agent-id`.

## Architecture Decisions

### Codex Adapter Is Reusable

`src/backend/adapters/codex/` owns Codex provider behavior:

- app-server process lifecycle
- JSON-RPC transport over stdio
- provider-native thread and turn semantics
- notification normalization
- server requests and future approval handling
- skills, transcript reading, resume/list support, and provider capabilities

The coding tool may use Codex first, but Codex is not a coding-tool-only
implementation detail. A future normal Codex chat agent should use the same
adapter through the backend facade.

### Coding Is A Daemon Tool, Not A Chat Agent

The coding capability is a daemon-level tool/session service. It is not a
normal chat agent and does not need a user-facing agent identity.

Chat agents may invoke the coding tool, but that relationship is provenance and
linkage, not ownership. Chat-to-coding links live in a sidecar table keyed by
structured chat identity plus structured coding identity; the coding session
itself is owned by the coding tool service and does not know which chats link to
it.

Consequences:

- browser Code mode lists coding repositories and sessions globally
- coding sessions do not depend on `cwd/.agent-id`
- repositories do not store a `default_agent_id`
- user-initiated coding sessions do not require a selected chat agent
- any `agent_id` needed by shared storage is an internal storage namespace, not
  a chat-agent identity
- linked chat is one-way chat-to-coding provenance, not coding-session
  ownership

### Coding Runtime Owns Code-Session Policy

`src/runtime/coding/` owns coding-session orchestration:

- required `cwd`
- chat-session linkage
- parallel coding sessions
- repository registration and grouping
- browser tab identity
- right-panel workspace binding
- coding-session status
- coding-session event replay and live progress fanout
- coding-session persistence policy

The coding runtime delegates provider execution to a backend facade. It does not
own Codex protocol details.

### Coding Session Stream Is First-Class

Coding sessions need an Outclaw-owned progress stream. Start and resume commands
are one-off mutation operations, but their identity behavior differs:

- start creates identity: it waits until Codex has created the provider thread,
  returns the new session ref, and exits without waiting for the full turn
- resume uses identity: it validates an existing session ref, accepts a follow-up
  turn for that session, returns the same ref, and exits without waiting for the
  full turn

Monitor commands attach to the coding session stream.

The stream contract:

- is keyed by provider session identity, not active chat binding
- exposes normalized coding events with a per-stream monotonic sequence
- supports late attach by reading provider-owned JSONL history before following
  live events
- carries status, prompts, assistant text, thinking, tool calls, approvals,
  command output, patches, usage, and completion/failure state as those event
  shapes become available
- is rendered by CLI monitor, TUI, and browser from the same event model

The monitor is a terminal projection of a first-class coding session, not a raw
Codex terminal tail. Provider adapters normalize provider-native notifications;
backend adapters own provider transcript parsing; runtime/coding owns metadata,
live event subscription, and replay/follow coordination; frontends only render
the normalized stream.

Do not introduce a second primary coding-session id unless a future requirement
requires monitor attach before provider initialization. The current start
contract waits only for `session_initialized`, and resume already receives an
existing session ref, so `provider_id/sdk_session_id` is the canonical
coding-session ref. The generic `oc_session_id` can remain a compatibility alias
inside shared session storage, but it is not the primary coding-session identity.

The Codex app-server does not currently accept a caller-supplied thread id on
`thread/start`. Local probing against `codex-cli 0.130.0` showed that extra
`id`, `threadId`, and `sessionId` fields are ignored and Codex returns its own
generated `thread.id`.

### Runtime Application Owns Reusable Mechanics

`src/runtime/application/` may expose provider-neutral mechanics needed by chat
and coding:

- detached prompt execution
- task-level cwd
- optional runtime system prompt inclusion
- session tag/source persistence
- background completion persistence
- execution lane lifecycle

It must not choose coding-tool policy, expose a `runCodePrompt` API, or branch
on provider identity such as `codex`.

### Provider Process Lifecycle

The daemon owns provider subprocess lifecycle. For Codex, the daemon starts:

```text
codex app-server --listen stdio://
```

The Codex adapter speaks JSON-RPC over newline-delimited stdin/stdout. This is
analogous to the Claude adapter using the Claude Agent SDK: provider boundaries
own provider-native subprocess/session behavior, while runtime code sees only
normalized facade events and explicit capabilities.

Initial process shape: one Codex app-server process per daemon/provider
instance, multiplexing multiple Codex threads/sessions. Do not change to one
process per coding session without evidence.

### Storage Decision

Coding sessions are a first-class domain, not just chat sessions with a
different label.

Use the existing `sessions` table as the shared provider-session anchor for:

- common identity
- title
- model
- source and tag
- usage
- transcript/search data
- failure fields

Store coding-only metadata in a `coding_sessions` sidecar keyed by the same
provider session identity.

```text
sessions
  agent_id            # internal storage owner; coding rows use a fixed owner
  provider_id
  sdk_session_id
  oc_session_id
  title
  model
  source
  tag
  usage and transcript-owned columns

coding_repositories
  id
  root_cwd
  display_name
  remote_url
  source
  status
  created_at
  last_active
  archived_at

coding_sessions
  storage_owner_id
  provider_id
  sdk_session_id
  repository_id
  cwd
  linked_chat_session_id        # legacy/single-link compatibility only
  browser_tab_id
  lifecycle_status
  run_status
  created_at
  last_active

chat_coding_links
  chat_agent_id
  chat_provider_id
  chat_sdk_session_id
  coding_storage_owner_id
  coding_provider_id
  coding_sdk_session_id
  first_linked_at
  last_linked_at
```

`coding_sessions` must reference `sessions` with `ON DELETE CASCADE`, so generic
session deletion also removes coding metadata. Code-session queries that need
coding metadata should go through a `runtime/coding` API rather than teaching the
generic session store about cwd, browser tab state, or code-session run status.
When reusing the shared `sessions` schema, coding rows use a fixed internal
storage owner in the `agent_id` column. That value must not be presented as a
chat agent or used for chat-agent routing.

`chat_coding_links` is the canonical chat provenance surface. The chat side
stores `agent_id + provider_id + sdk_session_id`; the coding side stores
`provider_id + sdk_session_id` plus the internal coding storage owner needed for
foreign-key cleanup. The relationship is intentionally one-way: deleting a chat
session or coding session removes the link, but the coding session remains
globally visible in Code mode and never routes through chat ownership.

`coding_repositories` is the durable repo list for coding UX. It is not browser
local state and should be updated only through coding-owned runtime APIs. The
repo identity is a canonical project root used for grouping and session
creation, while each coding session still stores its exact `cwd` so subdirectory
or monorepo workflows do not lose precision.

Repo registration is idempotent by canonical `root_cwd`. Starting a coding
session for an unregistered repo auto-enlists that repo. Manual add registers an
existing local path. Clone creates a local checkout through daemon/runtime-owned
process execution, then registers the resulting root.

The registry is daemon-global for browser navigation. User-initiated session
creation routes to the daemon coding service, not to a selected chat agent.
Removing a repo from the visible list should archive the repo entry by default,
not delete historical coding sessions.

Coding-session interaction history is provider-owned. For Codex, the adapter
reads the app-server JSONL transcript path discovered through `thread/resume`
and projects it into provider-neutral coding-session events. Outclaw SQLite
stores only metadata needed to find, display, resume, archive, and route a
coding session; it must not persist a duplicate normalized interaction log.

The coding schema is still pre-MVP groundwork. Do not carry migration shims or
legacy compatibility paths for discarded scaffold columns until the coding
storage contract has shipped as stable user data.

`lifecycle_status` describes whether the coding session remains visible and
resumable, for example `open` or `archived`. `run_status` describes the current
or last turn, for example `idle`, `running`, or `failed`. A completed turn makes
the coding session `idle`; it does not close the coding session. Code-mode
removal archives sessions by default: normal lists and search include open
sessions, archived lists and search include archived sessions, and restore moves
the session back to the open/resumable set.

Browser tab layout is not durable product state for the MVP. The durable state is
repository/session metadata plus provider-owned transcript history. Code mode may
persist per-browser, per-project tab layout locally for convenience, but shared
cross-browser tab restore should not get schema or API surface until a concrete
workflow needs it.

## Module Ownership

### Backend

- `src/backend/adapters/claude/`: Claude SDK provider behavior.
- `src/backend/adapters/codex/`: Codex app-server provider behavior.
- `src/backend/facade-registry.ts`: provider facade construction.

Backend adapters own provider behavior. They may import `common/`, but they must
not import `runtime/` or `frontend/`.

### Runtime Application

`src/runtime/application/` owns provider-neutral chat/session execution
mechanics: active session state, queues, prompt dispatch, persistence hooks,
auto-title, rollover, cron, heartbeat, and detached execution.

### Runtime Coding

`src/runtime/coding/` owns coding-tool policy. The current public operations are
explicit start, resume, and stop APIs: start returns after provider session
initialization, resume validates an existing session ref and returns after the
follow-up turn is accepted, and stop interrupts the active turn for an existing
session ref. Start and resume do not wait for turn completion.

The runtime coding boundary:

- requires `cwd`
- creates canonical provider session identity during start
- resolves canonical provider session identity during resume
- registers and looks up coding repos by canonical project root
- runs detached from active chat
- stores sessions with `tag = "code"` and `source = "code"`
- avoids runtime system prompt injection so Codex can use its default coding
  instructions
- records coding session lifecycle separately from current/last turn status
- links coding sessions to their registered repo when available
- stores chat-to-coding provenance in `chat_coding_links` when a chat session
  invoked the coding tool
- records coding-session stream events and exposes replay/follow subscriptions

### Supervisor

The supervisor owns control-message routing. Current `code_prompt` handling is a
transitional control path:

- validates prompt and cwd
- resolves the owning agent from `cwd/.agent-id`
- calls `runtime.coding.startPrompt()`
- waits for provider session initialization
- returns the canonical `providerId/sdkSessionId` coding-session ref

Browser entry points call the daemon-level coding service with explicit repo,
cwd, and optional linked chat session id. Future TUI/CLI entry points should use
the same boundary and should not rely on `cwd/.agent-id` or selected chat-agent
fallback.

### Frontend

Frontend owns code-session UX, not provider behavior. Browser and TUI should
render normalized runtime/protocol events. Provider-native Codex payloads should
not leak into frontend code.

## Data Flow

Request normalization:

1. A chat agent or user entry point creates a code prompt with `cwd`, `prompt`,
   optional `repositoryId`, and optional `linkedChatSessionId`.
2. The daemon-level coding service resolves or registers the repository.
3. The coding service submits prompt execution with `storedSessionSource =
   "code"`, `sessionTag = "code"`, and `includeRuntimeSystemPrompt = false`.

Start acknowledgement path:

1. Start calls Codex `thread/start` through the coding facade.
2. Start blocks the caller only until the Codex adapter emits
   `session_initialized`.
3. Start returns the new `provider_id/sdk_session_id`.
4. If provider initialization fails, start returns an error and should not
   create a durable coding session.

Resume acknowledgement path:

1. Resume validates an existing coding-session ref.
2. Resume verifies the session is open and not busy.
3. Resume submits the follow-up prompt execution with `resume = sdk_session_id`.
4. Resume returns the same session ref after Outclaw accepts the turn.
5. Provider resume or turn-start failures after acceptance are recorded as run
   failure events on that existing coding session.

Execution and monitoring path:

1. `runtime/application` executes accepted coding turns through the coding
   facade.
2. The Codex adapter starts or resumes the provider thread, starts the turn, and
   normalizes app-server notifications into `FacadeEvent`.
3. The generic session store persists the shared session row under the coding
   storage owner.
4. `runtime/coding` records or updates `coding_sessions` with repo id, cwd,
   linked chat session id, browser tab id, lifecycle status, run status, and
   timestamps.
5. `runtime/coding` records normalized progress events for the coding session
   and fans them out to any active monitors.
6. Browser code-session APIs list repos, create/resume/stop sessions under a
   repo, switch focused code tabs, replay progress, and display sessions through
   coding-owned interfaces. TUI and CLI should consume the same coding-owned
   interfaces when they are added.

The active chat session must remain unchanged by a coding prompt.

## Current Implementation

Completed groundwork:

- Claude provider files are grouped under `src/backend/adapters/claude/`.
- Codex has an adapter scaffold under `src/backend/adapters/codex/`.
- Codex can start/resume app-server threads, start turns, and normalize a simple
  text turn into the existing `FacadeEvent` contract.
- Codex app-server stderr is consumed so the subprocess pipe cannot block.
- Codex adapter owns app-server client disposal.
- Codex JSON-RPC transport rejects unknown server requests by default and has a
  server-request hook for future approvals.
- `src/runtime/coding/` exists as the coding-tool runtime boundary.
- `CodingSessionStore` owns the `coding_sessions` sidecar table.
- `CodingSessionStore` can list and read coding-session details joined with
  shared `sessions` metadata, including cursor pagination and linked-chat
  filtering.
- `CodingSessionStore` stores lifecycle status separately from current/last run
  status. Completed turns make the session idle, not closed.
- `CodingSessionStore` has run-status helpers for running, completed, and
  failed turns; failed status persists the shared session failure message.
- `CodingSessionStore` can archive and restore coding sessions by lifecycle
  status. Default list/search results show open sessions; archived list/search
  results are explicit.
- Destructive coding-session delete still goes through the shared `sessions`
  row and relies on sidecar cascade cleanup, but Code mode uses archive/restore
  as the visible removal path.
- Coding storage uses a fixed internal owner in the shared `sessions.agent_id`
  column instead of a chat-agent identity.
- `CodingRepositoryStore` owns the daemon-global `coding_repositories` table,
  canonical root de-duplication, active/archive status, and auto registration
  by nearest git root.
- Coding repositories no longer store or expose `default_agent_id`.
- Coding sessions can link to a repository id while preserving their exact
  session `cwd`.
- Coding runtime auto-enlists the repository for a coding prompt cwd before
  recording the provider session sidecar row.
- Coding runtime still stores `linkedChatSessionId` for legacy/single-link
  compatibility; `chat_coding_links` owns canonical multi-link provenance.
- Browser API exposes coding-session list, detail, archive, restore, and delete
  operations through `runtime/coding` storage instead of generic session-store
  shortcuts.
- Browser HTTP routes and browser client helpers can list, read, archive,
  restore, and delete daemon-level coding sessions by explicit provider session
  identity.
- Browser API, HTTP routes, and browser client helpers expose repository list,
  detail, daemon-level manual registration, clone execution/registration, and
  archive/restore operations.
- Coding-session list APIs can filter by repository id and include
  `repositoryId` in session summaries.
- A single daemon-level coding service (`createCodingService`) owns the coding
  execution lane, live event hub, and repositories; each `createAgentRuntime`
  just receives a `coding: CodingRuntime` reference. Zero-agent installs can
  still start coding sessions.
- Production daemon composition keeps Claude for normal chat and shares one
  Codex adapter through the daemon coding service.
- Detached one-shot execution lanes are retired after completion.
- `code_prompt` control messages start a cwd-bound coding prompt, wait for
  provider session initialization, return `providerId/sdkSessionId`, and do not
  change the active chat session.
- `CodingRuntime.resumePrompt()` validates an explicit `providerId/sdkSessionId`
  ref, requires an open and idle coding session, submits the turn with
  `resume = sdkSessionId`, and returns the same ref after Outclaw accepts the
  turn.
- Detached coding resume passes the provider session id through
  `runtime/application` without rebinding the visible chat session.
- A live Codex app-server probe showed that `thread/start` generates its own
  thread id; caller-supplied `id`, `threadId`, and `sessionId` params are not
  honored.
- Coding-session history comes from provider-owned JSONL rehydration. The
  runtime keeps only an in-process live event hub for active turns, and browser
  SSE exposes a replay/follow AsyncIterable by reading provider history first,
  then following live hub publishes with synthetic per-stream sequence numbers.
- Browser API exposes daemon-level `startCodingSession`,
  `resumeCodingSession`, and `openCodingSessionEventStream`. HTTP routes:
  `POST /api/coding/sessions`, `POST /api/coding/sessions/:provider/:id/resume`,
  `GET /api/coding/sessions/:provider/:id/events` (SSE). Browser client helper
  reconnects with `sinceSequence` cursor when the EventSource drops.
- Codex stream normalizer maps `item/started`+`item/completed` for
  `commandExecution` to `command_execution_started`/`command_execution_completed`,
  and `item/completed` for `fileChange` to `file_change_applied` with typed
  add/update/delete/move + unified diff payloads.
- Deprecated `persistExtendedHistory` parameter dropped from the Codex adapter
  start and resume calls.
- Codex adapter forwards `model` only when it looks Codex-shaped
  (`gpt-*`/`codex*`). Claude-side aliases from the runtime default no longer
  leak into Codex calls; Codex falls back to its config default.
- Codex adapter exposes `listModels()` through provider-owned `model/list`,
  including default model, supported reasoning efforts, and service tiers.
- Coding runtime start/resume accepts model, effort, and service-tier overrides
  and forwards them through detached execution without mutating chat state.
- Browser Code mode ships as a full-page swap toggled from the chat sidebar:
  `CodingPage` shows registered repos in a left rail, sessions nested under each
  repo, per-repo session search, repo-scoped code tabs, a new-session prompt
  composer for empty selections, and an active session pane that streams the SSE
  event log with typed renderers plus a resume composer.
- Browser client `openCodingSessionEventStream` tracks the last seen sequence
  and reconnects with `?sinceSequence=N` after EventSource drops.
- Browser Code mode can start, resume, stop, rename, archive, restore, search,
  and stream coding sessions through daemon-level coding APIs.
- CLI `oc coding <repo-id-or-path|provider/session> "<prompt>"` is the
  agent-facing short form. Existing local paths start a coding session, explicit
  `provider/session` refs resume an existing coding session, and other targets
  are submitted as registered repository ids.
- CLI `oc coding start <repo-id-or-path> "<prompt>"` starts a daemon-owned
  coding session through the daemon coding API, prints the accepted
  `providerId/sdkSessionId` ref, and exits after provider session initialization.
- CLI `oc coding resume <provider/session> "<prompt>"` sends a follow-up prompt
  through the daemon coding API, prints the accepted `providerId/sdkSessionId`
  ref, and exits after the turn is accepted. Archived sessions are restored by
  the daemon resume path before the prompt is accepted.
- CLI `oc coding monitor <provider/session>` checks status first, replays
  normalized prior coding events, follows live events only while the latest turn
  is running, blocks until the observed turn reaches `done` or `error`, and
  relies on the caller's shell/tool timeout for interruption.
- CLI `oc coding status <provider/session>` reads the daemon coding-session
  status. It prints `running` for an active latest turn, `error: <message>` for
  a failed latest turn, or `done` plus the final assistant response after the
  latest turn is idle.
- When `oc coding` is invoked from an agent home, the CLI resolves the active
  chat session through the daemon and sends that chat identity as internal
  headers. Start, resume, status, and monitor therefore upsert
  `chat_coding_links` after their target coding session has been accepted or
  validated.
- Browser Code mode supports repo add from an existing local folder and
  clone-from-URL. Clone execution is daemon-owned through `git clone`, then the
  resulting checkout is registered in `coding_repositories`.
- Browser Code mode can archive active repo groups, restore archived projects,
  open a single archived-session modal from the bottom action row beside Add
  repo, search archived sessions separately from open sessions, group archived
  sessions by project in that modal, and restore archived sessions into the
  normal repo session list.
- Browser Code mode uses provider model metadata for a Codex model selector,
  reasoning-effort selection, service-tier fast mode, and a live context meter
  fed by `usage_updated` and final `done` events.
- Code-mode middle tabs are scoped to the focused repository. Session, file, and
  diff tabs reuse the shared tab-strip shape; file previews reuse `FileViewer`
  and diff tabs reuse the git diff viewer against the focused repository.
- The browser event renderer covers text, thinking, status, command executions
  including output deltas, file changes, web search, subagent tool calls, generic
  tool calls, errors, and completion state. Approval rendering is still pending.
- Browser SSE replay reads provider-owned Codex JSONL history as the source of
  truth, then follows in-process live events for the active turn.

Current limitations and explicit deferrals:

- `code_prompt` control entry point now passes the agent's active chat session
  as `linkedChatSessionId` explicitly via `AgentRuntime.getActiveSessionId()`;
  browser clients call the daemon coding service directly through browser API
  routes. CLI start/resume now also call the daemon coding service directly; TUI
  entry points are still pending.
- Coding-session ref resolution supports explicit `providerId/sdkSessionId` and
  exact bare provider-session ids when the bare id is unambiguous.
- Code mode remains a deliberate full-page swap from Chat mode for the MVP. It
  has its own repository-scoped code tabs; shared chat/code middle-panel tabs are
  deferred until a concrete cross-mode workflow requires them.
- Approval-modal UX is not implemented yet.
- The right-panel workspace (files / git / terminal) is bound to the focused
  repository root, not to per-session sub-cwds inside a monorepo.
- CLI `oc coding monitor` has no dedicated timeout, `--until`, or `--follow`
  flags in the first slice. Human or agent callers control interruption at the
  shell/tool layer.
- Codex event normalization covers text, thinking, live/final usage, done,
  command executions, command output deltas, file changes, web search, subagent
  tool calls, and generic tool calls. Approvals are still missing. Richer item
  status or token accounting should be added only when observed Codex payloads
  need a distinct provider-neutral field that the current event model cannot
  represent.
- Provider-owned Codex transcript rehydration can read a known session's
  transcript path through `thread/resume`. Outclaw-owned session metadata remains
  the list/search source of truth; provider-native transcript import/list/search
  is deferred until external Codex-session adoption is designed.
- Browser coding starts use the provider model catalog, but non-browser or
  agent-initiated starts without an explicit model still rely on Codex adapter
  filtering so Claude-side aliases do not leak into Codex calls. A broader
  provider-neutral default-model contract is still missing.
- TUI and Telegram have no code-session UX yet.

## Roadmap

### 0. Groundwork And Composition

- [x] Group Claude provider files under `backend/adapters/claude/`.
- [x] Add Codex app-server adapter scaffold.
- [x] Add `runtime/coding/` as the coding-tool runtime boundary.
- [x] Add `coding_sessions` sidecar storage.
- [x] Add control `code_prompt` routing.
- [x] Let `createAgentRuntime()` compose separate chat and coding facades.
- [x] Wire production coding runtime to a shared Codex adapter.
- [x] Preserve active chat identity during coding prompts.
- [x] Retire completed detached execution lanes.
- [x] Add Codex adapter disposal, stderr draining, and server-request hook.

### 1. Coding Session Store API

- [x] Add coding-owned list and get-detail APIs that join `coding_sessions` with
  shared `sessions` metadata.
- [x] Add status update helpers for `running`, `completed`, and `failed`.
- [x] Store failure message details when Codex reports an error.
- [x] Add delete behavior through the coding API, backed by generic session
  deletion plus sidecar cascade.
- [x] Add archive/restore behavior through the coding API, backed by coding
  lifecycle status instead of destructive deletion.
- [x] Move coding storage to a daemon-level internal owner instead of per-chat
  agent ownership.
- [x] Remove repository `default_agent_id` and any user-facing chat-agent route
  from coding repository registration.
- [x] Add `chat_coding_links` sidecar storage for one-way chat-to-coding
  provenance keyed by provider/session identity.
- [x] Split coding-session lifecycle status from current/last run status.
- [x] Store provider/session metadata needed by Codex thread resume.
- [x] Keep Code-mode tab layout browser-local for the MVP; do not add durable
  shared tab restore schema until a concrete workflow needs it.
- [x] Use provider-owned JSONL history plus an in-process live event hub instead
  of storing duplicated coding-session interaction history in SQLite.
- [x] Add `coding_repositories` storage with canonical root de-duplication,
  manual add, archive, and clone registration.
- [x] Link coding sessions to repositories without losing exact session `cwd`.
- [x] Auto-enlist a repo when a coding session starts for an unregistered cwd.
- [x] Add repo-list APIs for list, detail, add existing path, archive, and
  clone execution/registration.
- [x] Add tests for storage-owner/provider scoping, cascade deletion,
  pagination, and linked-chat filtering.

### 2. Browser Coding API

- [x] Add runtime browser API methods for coding-session list, detail, archive,
  restore, and delete.
- [x] Add HTTP routes for coding-session list, detail, archive, restore, and
  delete.
- [x] Keep provider id explicit in coding-session detail, archive, restore, and
  delete routes.
- [x] Add browser client helpers for coding-session list, detail, archive,
  restore, and delete.
- [x] Wire daemon composition so browser API receives a daemon-level
  `CodingSessionStore`.
- [x] Replace per-agent browser coding APIs with daemon-level coding APIs.
- [x] Add browser API methods, HTTP routes, and client helpers for repository
  list, detail, registration, and archive.
- [x] Add repository filtering to coding-session list APIs.
- [x] Add search once code-session title/search UX is designed.
- [x] Add follow-up prompt and resume endpoints after coding-session lifecycle is
  settled.
- [x] Add replay/follow endpoints for coding-session progress once the
  normalized event stream exists.
- [x] Add daemon-level start endpoint backed by a single daemon coding service
  (no per-agent CodingRuntime).
- [x] Add daemon-level stop endpoint backed by the coding runtime.
- [x] Add provider model catalog endpoint and browser client helper for Code
  mode model selection.
- [x] Add active-chat and chat-linked-coding HTTP routes for CLI linkage and
  future chat-mode UI placement.

### 3. Coding Runtime Lifecycle

- [x] Define the difference between a completed coding turn and an open coding
  session that can receive more turns.
- [x] Make `start` wait only until provider session initialization, return the
  new `providerId/sdkSessionId`, and avoid streaming turn output inline.
- [x] Make `resume` validate an existing coding-session ref, accept a follow-up
  turn, return the same ref, and avoid streaming turn output inline.
- [x] Resolve coding session refs from explicit `providerId/sdkSessionId` and
  unambiguous bare provider session id; keep `ocSessionId` as compatibility
  metadata, not the primary coding-session ref.
- [x] Reject concurrent turns inside one coding session by provider thread while
  different coding sessions run in parallel.
- [x] Add runtime-level coding-session resume and follow-up prompt APIs.
- [x] Add runtime-level coding-session stop/interrupt API for active turns.
- [x] Keep detached lanes ephemeral after each turn unless future evidence shows
  resumable coding sessions need retained lanes.
- [x] Record normalized coding-session progress events during start and resume
  runs.
- [x] Expose monitor subscriptions that replay persisted coding-session events
  and then follow live progress.
- [x] Preserve Codex default coding instructions unless an explicit coding
  prompt override is introduced.

### 4. Codex Event Model

- [x] Extend `common/protocol.ts` and the backend facade with structured tool
  invocation events (command_execution_started/completed, file_change_applied).
- [x] Normalize command output (aggregated stdout/stderr surfaces on
  `command_execution_completed.output`).
- [x] Normalize file patches (add/update/delete/move with unified diff on
  `file_change_applied.changes[]`).
- [x] Normalize live Codex token-usage updates into `usage_updated` events.
- [x] Normalize web-search, subagent, and generic tool calls into typed
  provider-neutral events.
- [x] Keep item status in the current typed tool/status events instead of adding
  speculative item-status events.
- [x] Use live/final `usage_updated` snapshots for the current context meter and
  status surfaces; defer richer token accounting until a concrete consumer needs
  it.
- [x] Add provider-owned Codex event rehydration for a known session transcript.
- [x] Use Outclaw session metadata for list/search and provider JSONL only for
  known-session rehydration; defer provider-native transcript import until an
  external-session adoption workflow is designed.
- [x] Keep provider-native Codex payloads out of `runtime/` and `frontend/`.

### 5. Browser Coding UX

- [x] Add a left-sidebar Chat/Code switcher (Code button in agent sidebar +
  Chat button in code sidebar header).
- [x] In Code mode, show registered repos as project groups in the left sidebar.
- [x] Nest coding sessions under their repo group, backed by the coding store
  API, with per-repo session search.
- [x] Add repo action for picking an existing local path.
- [x] Add repo action for clone-from-URL.
- [x] Add visible repo archive action in Code mode.
- [x] Add a single archived-session action beside Add repo in the bottom action
  row that opens a modal with archived search and project-grouped archived
  sessions.
- [x] Add daemon-owned git clone execution for clone-from-URL.
- [x] Add a repo-scoped prompt composer for starting a new coding session
  directly.
- [x] Add Code-mode middle tabs scoped to the focused repository.
- [x] Add session, file, and diff tab kinds in Code mode.
- [x] Keep Code mode as a dedicated full-page surface for the MVP instead of
  merging code tabs into the chat middle-panel tab strip.
- [x] Keep chat active-session binding separate from focused code-tab identity
  (separate Zustand store).
- [x] Bind right-panel file/git/terminal workspace root to the focused code
  session's repository root. (Per-session sub-cwd inside a monorepo still falls
  back to the repo root; revisit if monorepo workflows need finer scoping.)
- [x] Hide or de-emphasize non-coding tabs such as cron/inbox while a code
  session owns the right panel. (Code mode mounts a dedicated right panel with
  only Files, Git, and Terminal.)
- [x] Add renderers for command executions, command output, patches, web search,
  subagents, generic tool calls, and code-session status. Approval renderer
  pending (yolo mode skips approvals for now).
- [x] Keep full underlying paths available even if UI labels are shortened
  (full cwd is shown under the session title; repo rootCwd shown in sidebar).

### 6. TUI And CLI

- [x] Add the first explicit user entry point for starting a code session from a
  local repo path or registered repo id.
- [ ] Add CLI repo discovery so users can list registered repository ids without
  opening Browser.
- [ ] Add repo commands for add existing path, clone, archive, restore, and
  inspect.
- [x] Add `oc coding <repo-id-or-path|provider/session> "<prompt>"` as the
  agent-facing short form for start-or-resume-by-target.
- [x] Add `oc coding start <repo-id-or-path> "<prompt>"` as the canonical
  initialize-and-return start command.
- [x] Add `oc coding resume <provider/session> "<prompt>"` as the canonical
  validate-and-return resume command.
- [x] Add `oc coding monitor <session-ref>` to replay prior progress and follow
  live coding-session events.
- [x] Keep CLI monitor session-scoped for the MVP; defer multi-session or
  repo-filtered monitoring to Browser/TUI or a separately designed dashboard.
- [x] Add `oc coding status <session-ref>` as a non-streaming snapshot.
- [x] Make `oc coding` infer agent active-chat context from cwd and send it to
  daemon coding routes for link creation.
- [x] Make CLI monitor replay-only for completed sessions and follow live events
  only while the latest turn is running.
- [ ] Add `/coding-session` list/switch/resume commands separate from
  `/session`.
- [x] Render structured coding events in CLI monitor now that command, patch,
  web-search, subagent, generic-tool, text, and status events exist.
- [ ] Improve CLI monitor formatting only where the current compact renderer is
  insufficient for real command output, patches, or long tool runs.

### 7. Telegram

- [ ] Defer code-session switching until browser and TUI lifecycle behavior is
  settled.
- [ ] Keep Telegram able to receive summaries or links to coding sessions if a
  later workflow needs it.

## Invocation Policy

### Agent-Initiated

The first supported flow is delegation from a chat agent through the control
path. The chat agent supplies the coding prompt and cwd. The resulting coding
session links back to the invoking chat session when known. That link is
provenance only; the chat agent does not own the coding session.

Agent-initiated CLI commands should use non-streaming mutation semantics:

```text
oc coding <repo-id-or-path|provider/session> "<prompt>"
oc coding start <repo-id-or-path> "<prompt>"
oc coding resume <provider/session> "<prompt>"
```

The short form starts when the target is an existing local path or registered
repo id, and resumes when the target is an explicit `provider/session` ref.
`start` waits only until Codex emits `session_initialized`, prints the new
coding session ref, and exits. `resume` validates the existing session ref,
accepts the follow-up turn, prints the same ref, and exits. None of these
commands wait for the Codex turn to complete or stream the result inline. Agents
that need progress or the final result attach explicitly:

```text
oc coding monitor <session-ref>
oc coding status <session-ref>
```

`monitor` is a blocking attach command. It renders the normalized
`CodingSessionEvent` stream, including assistant text and compact evidence for
tool use such as commands, file changes, web search, subagents, and generic tool
calls. It has no monitor-specific timeout or alternate termination flag in the
MVP; callers should use their shell/tool timeout when they need one. `status`
prints only the coarse turn state and final assistant response; it does not
replay intermediate tool evidence.

The stable user-facing ref is the provider session identity, preferably
formatted as `providerId/sdkSessionId` when ambiguity is possible. Do not
introduce a second Outclaw-owned coding session id only to make start return
earlier. If provider initialization fails, start should return an error instead
of creating a half-identified coding session. If resume is given an unknown,
archived, or currently busy session, it should fail before accepting a turn.

### User-Initiated

User-initiated coding sessions use the repo list as the cwd policy.

- The user may start from Browser Code mode, TUI, or CLI.
- The user selects a registered repo, or adds/clones one first.
- The selected repo supplies the default project root.
- The prompt may override the exact session `cwd` only within that repo root.
- The session is created by the daemon-level coding service, not by a selected
  chat agent.
- The resulting coding session may have no linked chat session.

Chat-agent delegation remains supported and is still the preferred path when
task clarification is useful. Direct repo initiation is for cases where the user
already knows the project and wants to start a coding session immediately.

## Testing Strategy

Use vertical TDD slices through public interfaces:

- backend adapter behavior through the `Facade` contract
- runtime coding behavior through `CodingRuntime`
- daemon/runtime composition through `createAgentRuntime`
- supervisor control behavior through WebSocket/control messages
- storage behavior through the coding store API
- browser/TUI behavior through their public event/API surfaces

Mock only external seams: provider app-server clients, subprocesses, filesystem,
time, network, and browser WebSocket clients.

Run `bun run check` before considering an implementation slice complete.

## Reference Projects

- `/Users/yishentu/Projects/claudian`: provider/runtime integration and
  Codex/Claude coding-session UI references.
- `/Users/yishentu/Projects/dylan-reed`: browser middle-panel and tool-rendering
  reference if implementation details are unclear.
