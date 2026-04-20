# Browser

## Overview

The browser frontend is a React/Vite SPA that connects to the outclaw daemon
over the existing websocket protocol. It is not a new runtime surface. It is a
browser rendering of the same bound-agent event stream the TUI already uses,
with browser-native navigation and inspection affordances around that stream.

The browser has two shipped entry states:

- an initial welcome page with agent selection and a compact composer
- the main three-column workspace after the user opens the workspace by sending
  a prompt or switching into a session

The main workspace is a three-column layout:

- left: agent and session navigation
- middle: one permanent chat tab plus file, git-diff, and git-commit preview tabs
- right: local inspection tools for `~/.outclaw/` and the active agent

If TUI and browser are both bound to the same agent runtime, they stream the
same conversation content at the same time.

The current supervisor also keeps interactive agent selection shared across TUI
and browser: switching agents in either surface rebinds the other connected
interactive clients to the same runtime.

## Scope

This document owns browser-specific behavior only:

- module ownership inside `src/frontend/browser/`
- welcome-page flow plus three-column layout shell and resize / collapse
  behavior
- left sidebar agent/session management UX
- center workspace tabs and chat rendering
- right sidebar file / cron / git / terminal inspection UX
- browser-local persisted layout state
- browser HTTP and websocket usage

Runtime semantics, replay semantics, and provider behavior remain owned by:

- `../architecture/frontend.md`
- `../architecture/runtime.md`
- `../architecture/agents.md`

## Design Principles

The browser frontend stays intentionally conservative:

- no browser-specific transcript model
- no Telegram-style routing semantics
- no tool-event dependency for file refresh or transcript rendering
- same interactive-client binding rules as TUI
- same `last_interactive_agent_id` remembered-agent fallback as TUI
- browser-specific layout and inspection state lives locally

The design language and many shell mechanics are adapted from
[dylan-reed](../../../dylan-reed) (`packages/frontend/`), but the browser keeps
outclaw-specific navigation, session, and filesystem behavior.

## Structure

```text
src/frontend/browser/
  app.tsx
  main.tsx
  observed-prompt.ts
  ensure-running-chat-session.ts
  send-prompt-to-agent.ts
  welcome-agent-selection.ts
  index.css
  index.html
  package.json
  postcss.config.js
  tailwind.config.js
  tsconfig.json
  vite.config.ts

  layouts/
    app-layout.tsx

  contexts/
    websocket-context.tsx

  components/
    connection-toast.tsx
    welcome-page.tsx
    welcome-agent-picker.tsx
    agent-sidebar/
      agent-sidebar.tsx
      agent-item.tsx
      session-item.tsx
      sidebar-notifications.tsx
      sidebar-runtime-status.tsx
    center/
      center-panel.tsx
      tab-bar.tsx
    chat/
      chat-panel.tsx
      message-list.tsx
      message.tsx
      message-input.tsx
      runtime-command-popup.tsx
      slash-command-menu.tsx
      model-selector.tsx
      context-gauge.tsx
      thinking-block.tsx
      thinking-indicator.tsx
    file-viewer/
      file-viewer.tsx
    git-diff-viewer/
      git-diff-viewer.tsx
    right-panel/
      right-panel.tsx
      right-panel-layout.ts
      file-tree.tsx
      cron-panel.tsx
      git-panel.tsx
      terminal-panel.tsx
      terminal-tabs.tsx
      terminal-view.tsx

  stores/
    agents.ts
    chat.ts
    context-usage.ts
    layout.ts
    runtime.ts
    runtime-popup.ts
    right-panel-refresh.ts
    sessions.ts
    slash-commands.ts
    tabs.ts
    terminal.ts
    workspace-view.ts

  lib/
    api.ts

  session.ts
```

## Transport And Binding

The browser extends `RuntimeClientType` with `"browser"` and connects as:

```text
ws://host:port?client=browser
```

It follows the same interactive-client contract as TUI:

- receives `runtime_status` immediately on connect
- receives a refreshed `runtime_status` after successful `/model` changes so
  the context gauge updates to the selected model window
- receives `history_replay` after connect and after session switch
- may receive `streaming_sync` immediately after replay when the selected
  session was already mid-stream in the background
- receives normal agent-scoped broadcast events
- sends prompts, runtime commands, and `request_skills`

Browser and plain `oc tui` share the same remembered interactive agent:

- fallback key: `last_interactive_agent_id`
- if no remembered value exists, the first discovered agent is used
- switching agents in one interactive surface rebinds the other connected
  interactive surfaces to the same agent runtime

The browser does not build its sidebar from `/agent` or `/session list`
commands. Cross-agent discovery and session summaries come from daemon-owned
HTTP endpoints.

Browser prompts travel through the same non-Telegram runtime path as TUI, but
the live runtime stream still tags them as `source="browser"` so browser-
originated `user_prompt` events remain distinguishable. Persistence and
delivery-target ownership still collapse those accepted prompts into the shared
interactive `{ kind: "tui" }` path rather than creating a browser-only durable
target kind.

## Layout

The browser starts on a welcome page and transitions into a fixed three-column
workspace shell.

### Welcome Page

Before the workspace is opened, the center pane shows a welcome page with:

- the `OUTCLAW` banner and random tagline
- a compact message composer
- a custom agent picker that targets the initial prompt

While this view is active:

- the left sidebar is forced visible even if it had been collapsed earlier
- the right panel stays hidden
- sending a prompt or selecting a session opens the normal workspace view

### Workspace Shell

Once the workspace is open, the browser uses a fixed three-column shell:

```text
┌──────────────┬───────────────────────────────┬──────────────────┐
│ Left Sidebar │ Center Workspace              │ Right Sidebar    │
│              │ Chat + file/diff tabs         │ Files/Cron/Git   │
│              │                               │ + Terminal pane  │
└──────────────┴───────────────────────────────┴──────────────────┘
```

The shell behavior is adapted from dylan-reed:

- draggable left and right column widths
- collapsible left and right sidebars
- fixed top header row alignment across all three columns
- persistent browser-local layout

Persisted layout state includes:

- `sidebarWidth`
- `inspectorWidth`
- `leftCollapsed`
- `rightCollapsed`
- `rightPanelUpperTab`
- `rightPanelSplitRatio`
- `rightTerminalCollapsed`

The browser uses a single warm palette. There is no browser theme toggle.

## Left Sidebar

The left sidebar owns agent and session navigation. It does not invent browser-
specific routing. Clicking a session drives the same runtime commands and
rebinding flow the TUI uses.

### Header And Footer

- top header: `OUTCLAW` branding plus collapse button
- subheader: `Agents and sessions`
- footer: runtime connection status plus a restart button that sends `/restart`

The footer height is part of the visual layout contract and is matched by the
collapsed terminal footer on the right sidebar.

### Notifications

Runtime and connection notices render in a stacked notification strip above the
sidebar footer.

Current items include:

- connection/reconnect state
- requested runtime status popups
- process-global `restart_required`
- agent-scoped `rollover`

Current rollover UX:

- renders a close affordance on the notification card
- keeps manual dismissal local to the browser until the notice changes
- auto-hides rollover after `5s`
- does not auto-hide `restart_required`

### Agent Rows

Each agent row is an accordion header with nested sessions.

- click the agent row: expand or collapse only
- clicking the agent row does not switch to that agent's active session
- drag the whole row to reorder agents locally in the sidebar
- drag feedback is a line indicator placed under the target agent block
- reordered agent order is persisted in browser local storage

The active agent is derived from websocket binding, not from local sidebar
state.

### Session Rows

Session rows are nested under each expanded agent.

- click: switch agent and/or session
- double click: rename inline
- hover: the relative timestamp becomes a delete action
- active session shows a left-side dot indicator
- timestamps are relative, but never show seconds; minimum granularity is `1m`

Switch flow:

1. if needed, send `/agent {name}`
2. wait for `agent_switched`
3. if needed, send `/session {sdkSessionId}`
4. wait for `session_switched` and `history_replay`
5. if that session was already running in the background, apply the partial
   stream catch-up snapshot and then continue live streaming

### Sidebar Data

The browser loads sidebar data from:

```text
GET /api/agents
```

That response merges:

- runtime discovery
- persisted active session per agent
- recent chat sessions per agent
- session titles, models, and `lastActive`

The browser refreshes this summary on initial load and after session mutations
such as switch, rename, delete, and agent switch.

## Center Workspace

After the welcome page hands off to the workspace view, the middle column is a
tabbed workspace. It always contains a permanent chat tab and may also contain
file-preview, git-diff, and git-commit tabs.

### Tabs

Supported tab types:

- `chat`
- `file`
- `git-diff`
- `git-commit`

Rules:

- the chat tab always exists and cannot be closed
- file tabs open from the file tree or cron panel
- git-diff tabs open from the git panel
- git-commit tabs open from the selected-commit card in the git panel
- tab state is local to the browser and independent from runtime session state

### Chat Panel

The chat panel is a browser rendering of the same active runtime session the
TUI shows.

- top subheader shows `agent / session title`
- markdown renders while streaming
- user and assistant spacing follows the Dylan Reed layout system
- messages wrap by default; no horizontal transcript scrolling
- the input toolbar includes model, thinking effort, context gauge, and send
- the model and thinking controls send normal runtime commands
- session-local streaming state is preserved per browser chat session key, so a
  user can switch away from a running session and switch back without losing
  already-streamed partial output

The thinking indicator behavior matches the TUI:

- before assistant output arrives: spinner + `Thinking...`
- once assistant output is streaming: spinner + `Working...`

### Runtime Command Popup

The browser keeps a runtime command popup aligned with the chat input instead
of inventing browser-only commands.

It is used for runtime-owned commands such as:

- `/agent`
- `/session`
- `/status`
- `/model`
- `/thinking`

Behavior:

- popup width is centered and narrower than the input row
- `Escape` closes the popup
- command submission removes focus from the input so one `Escape` is enough to
  dismiss the popup state

### File, Diff, And Commit Preview

File preview tabs are read-only.

- open from file tree or cron panel
- fetched from daemon HTTP endpoints
- syntax highlighted for code
- markdown-rendered for Markdown files
- binary files are represented as binary previews, not rendered as text

Git diffs are also rendered in the center workspace rather than the right
sidebar.

Git commit tabs render full commit metadata and patch content in the center
workspace.

- open from the selected-commit card in the git pane
- fetched from daemon HTTP endpoints
- show commit sha, author metadata, message, parents, and patch content

## Right Sidebar

The right sidebar has a fixed split:

- upper pane: one selected tool tab from `Files`, `Cron`, or `Git`
- lower pane: `Terminal` only

There is no draggable tab rearrangement and no terminal entry in the upper tab
set.

### Upper Pane

The upper-pane tab contract is fixed and persisted:

```text
["files", "cron", "git"]
```

#### Files

The file tree browses the active agent home directory:

```text
~/.outclaw/agents/<name>/
```

Behavior:

- fetched from `GET /api/agents/:agentId/tree`
- folders are collapsed by default
- nested items are indented
- clicking a file opens or focuses a center file tab

#### Cron

The cron pane lists jobs under the active agent `cron/` directory.

Behavior:

- fetched from `GET /api/agents/:agentId/cron`
- each item is expandable
- collapsed row shows title plus enabled toggle
- expanded content shows humanized schedule and model
- enabling/disabling a cron job uses a row-level toggle
- opening config opens the cron YAML in a center file tab

Cron enable state is updated through:

```text
PATCH /api/agents/:agentId/cron
```

#### Git

The git pane is scoped to the shared `~/.outclaw/` repository.

Behavior:

- shows branch state and clean/dirty state
- shows changed files
- shows a lightweight visual git graph, not inline diffs
- clicking a changed file opens the diff in the center workspace
- clicking a commit row toggles an inline selected-commit card inside the git
  graph
- the selected-commit card uses a solid background and overlays the graph
  without reflowing commit rows
- the selected-commit card shows commit message, author/date, and parent SHAs
- the selected-commit card may open a dedicated git-commit tab in the center
  workspace
- git graph rows do not expose commit metadata via hover-only tooltips

The browser does not render the git graph from preformatted CLI text. The
runtime returns structured commit history data, and the browser renders it with
an embeddable React graph component instead of re-parsing `git log --graph`
output.

The initial browser graph stays intentionally lightweight:

- short recent history window, not an unbounded history explorer
- no branch-management actions or mutation controls in the graph
- no commit-details side drawer; commit summary stays inline and full details
  open in a center tab
- same right-panel refresh invalidation flow as the rest of the browser sidebar

Structured git graph data is owned by:

- `src/common/protocol.ts` for the browser-facing response contract
- `src/runtime/browser/create-browser-api.ts` for git history collection and
  serialization
- `src/frontend/browser/components/right-panel/git-panel.tsx` for git-pane
  composition
- `src/frontend/browser/components/right-panel/git-graph.tsx` for graph
  rendering and inline commit selection
- `src/frontend/browser/components/git-commit-viewer/git-commit-viewer.tsx`
  for full commit inspection

### Terminal Pane

The lower pane is terminal-only.

Behavior:

- terminal header owns terminal tabs and creation controls
- terminal tabs can be renamed inline
- if only one terminal exists, its label is `Terminal`
- additional terminals are named `Terminal 2`, `Terminal 3`, and so on
- terminals are scoped per agent
- switching away does not destroy terminal state for the active agent

The lower pane can collapse into a footer strip.

- expanded state: header row plus terminal body
- collapsed state: footer row with chevron and `Terminal`
- collapsed footer height matches the left sidebar footer height

The split ratio between upper and lower panes is persisted locally.

## HTTP And Terminal Endpoints

The browser never reads SQLite directly. The daemon owns all data access.

### Sidebar

```text
GET /api/agents
```

Returns agent summaries plus recent session metadata.

### Files And Cron

```text
GET   /api/agents/:agentId/tree
GET   /api/agents/:agentId/cron
PATCH /api/agents/:agentId/cron
GET   /api/agents/:agentId/files?path=<relative>
```

Rules:

- file reads are constrained to the agent root
- path traversal and absolute paths are rejected
- cron operations are agent-scoped

### Git

```text
GET /api/git/status
GET /api/git/diff?path=<relative>
GET /api/git/commit?sha=<sha>
```

Git is global to `~/.outclaw/`, not per-agent.

`GET /api/git/status` returns both working tree status and a lightweight commit
graph payload. The graph payload is structured data, not ASCII art.

The response includes:

- repository root and branch/ahead/behind summary
- changed files for working tree navigation
- recent commits with:
  - `sha`
  - commit author name and date
  - commit message
  - parent SHAs
- branch heads with branch name and head SHA

The browser graph renderer consumes this payload directly. The runtime remains
responsible for git parsing, commit ordering, and branch-head discovery.

`GET /api/git/commit` returns full commit inspection data for the center
workspace commit tab.

The response includes:

- resolved commit sha
- author name, email, and date
- full commit message
- parent SHAs
- patch/diff content for the selected commit

### Terminal

```text
ws://host:port/terminal?agentId=<agentId>
```

This websocket relays a PTY-backed shell rooted at the active agent home
directory.

## Browser State

Browser-local state is owned by Zustand stores:

- `agents.ts` — agent list, active agent, persisted sidebar order
- `sessions.ts` — session summaries and active session per agent
- `chat.ts` — per-session rendered messages and streaming state
- `tabs.ts` — center workspace tabs and per-tab scroll state
- `layout.ts` — column widths, right-pane tab, split ratio, collapse state
- `workspace-view.ts` — welcome-page vs workspace mode
- `runtime.ts` — websocket connection and runtime presentation state
- `runtime-popup.ts` — runtime command popup visibility and content
- `right-panel-refresh.ts` — per-agent/sidebar invalidation revisions for tree,
  cron, git, and preview refreshes
- `context-usage.ts` — runtime token window usage
- `slash-commands.ts` — slash command and skill metadata
- `terminal.ts` — browser-local terminal tab state per agent

The browser does not persist transcript history locally. Runtime replay remains
daemon-owned.

## Serving And Launch

The shipped browser has both a daemon-served built mode and a separate Vite
development mode.

Rules:

- the daemon serves the built browser app from `/`
- non-API, non-terminal browser routes fall back to `index.html` for SPA
  navigation
- hitting `/` without a built bundle returns `503` guidance pointing to
  `oc build && oc restart`
- `oc start` ensures a browser build exists before daemon launch, but it does
  not force a rebuild when `dist/` already exists
- `oc build` always rebuilds the browser bundle
- `oc browser` starts the browser dev server only
- `oc browser` warns if the daemon is not running but still launches the dev
  server
- `oc browser` forwards any extra CLI args to the underlying Vite invocation
- hot reload is provided only by the Vite dev server path

The current launch model is intentionally simple:

- daemon serves websocket routes, browser HTTP/API routes, and the built SPA
- Vite serves the SPA in development
- rebuilding the packaged bundle stays explicit through `oc build`

## Reuse Map

The browser reuses Dylan Reed patterns selectively:

- column resize and collapse shell
- tab chrome and header alignment
- chat rendering style and spacing
- input toolbar styling
- xterm.js integration approach
- warm monochrome panel language

Outclaw-specific additions include:

- agent/session sidebar
- shared-runtime session switching
- file, git-diff, and git-commit tabs in the center workspace
- cron inspection and enable toggle
- right-sidebar terminal footer collapse
- browser-local agent ordering
