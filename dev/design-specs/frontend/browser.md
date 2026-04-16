# Browser

## Overview

The browser frontend is a React/Vite SPA that connects to the outclaw daemon
over the existing websocket protocol. It is not a new runtime surface. It is a
browser rendering of the same bound-agent event stream the TUI already uses,
with browser-native navigation and inspection affordances around that stream.

The browser workspace is a three-column layout:

- left: agent and session navigation
- middle: one permanent chat tab plus file and git-diff preview tabs
- right: local inspection tools for `~/.outclaw/` and the active agent

If TUI and browser are both bound to the same agent runtime, they should stream
the same conversation content at the same time.

## Scope

This document owns browser-specific behavior only:

- module ownership inside `src/frontend/browser/`
- three-column layout shell and resize / collapse behavior
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
    agent-sidebar/
      agent-sidebar.tsx
      agent-item.tsx
      session-item.tsx
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
    sessions.ts
    slash-commands.ts
    tabs.ts
    terminal.ts

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
- receives `history_replay` after connect and after session switch
- receives normal agent-scoped broadcast events
- sends prompts, runtime commands, and `request_skills`

Browser and plain `oc tui` share the same remembered interactive agent:

- fallback key: `last_interactive_agent_id`
- if no remembered value exists, the first discovered agent is used

The browser does not build its sidebar from `/agent` or `/session list`
commands. Cross-agent discovery and session summaries come from daemon-owned
HTTP endpoints.

## Layout

The browser uses a fixed three-column shell:

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
- footer: runtime connection status only

The footer height is part of the visual layout contract and is matched by the
collapsed terminal footer on the right sidebar.

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

The middle column is a tabbed workspace. It always contains a permanent chat
tab and may also contain file-preview and git-diff tabs.

### Tabs

Supported tab types:

- `chat`
- `file`
- `git-diff`

Rules:

- the chat tab always exists and cannot be closed
- file tabs open from the file tree or cron panel
- git-diff tabs open from the git panel
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

### File And Diff Preview

File preview tabs are read-only.

- open from file tree or cron panel
- fetched from daemon HTTP endpoints
- syntax highlighted for code
- markdown-rendered for Markdown files
- binary files are represented as binary previews, not rendered as text

Git diffs are also rendered in the center workspace rather than the right
sidebar.

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
- shows a git graph, not inline diffs
- clicking a changed file opens the diff in the center workspace

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
```

Git is global to `~/.outclaw/`, not per-agent.

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
- `runtime.ts` — websocket connection and runtime presentation state
- `runtime-popup.ts` — runtime command popup visibility and content
- `context-usage.ts` — runtime token window usage
- `slash-commands.ts` — slash command and skill metadata
- `terminal.ts` — browser-local terminal tab state per agent

The browser does not persist transcript history locally. Runtime replay remains
daemon-owned.

## Serving And Launch

The browser is a development surface launched separately from the runtime.

Rules:

- `oc start` starts the daemon only
- `oc browser` starts the browser dev server only
- `oc browser` warns if the daemon is not running but still launches the dev
  server
- hot reload is provided by Vite

The current launch model is intentionally simple:

- daemon serves websocket and HTTP API routes
- Vite serves the SPA in development
- asset bundling into the daemon is out of scope for this phase

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
- file and git-diff tabs in the center workspace
- cron inspection and enable toggle
- right-sidebar terminal footer collapse
- browser-local agent ordering
