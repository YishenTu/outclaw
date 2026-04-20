# Session CLI

## Scope

This document owns the daemonless `oc session ...` surface in `src/cli/session.ts`.

It covers:

- read-only session listing
- read-only content search
- session selector resolution
- transcript rendering
- cwd-based agent scoping

Provider transcript parsing itself remains backend-owned.

## Commands

```text
oc session list [--limit N] [--tag cron]
oc session search <query> [--limit N]
oc session transcript <id-or-prefix> [--limit N] [--tag cron]
```

Default tag is `chat`. `--tag cron` opts into cron sessions.

## Scope Detection

If the current working directory contains a valid `.agent-id` belonging to a
known agent, session reads are scoped to that `agent_id`. Otherwise the command
reads across all agents.

This is a convenience scope, not an authorization boundary.

## `list`

`oc session list` reads the shared SQLite `sessions` table through
`SessionQuery`, ordered by `last_active DESC`.

Current behavior:

- opens shared `db.sqlite` through `SessionQuery` and validates the current schema
- default `--limit 20`
- output is TSV with a header row
- displayed ids use the shortest unique prefix, with a minimum length of 12

Columns:

- `agent`
- `id`
- `title`
- `created`
- `last_active`

If nothing matches, print `No sessions`.

## `search`

`oc session search <query>` reads indexed transcript turns through
`SessionQuery.search(...)`.

Current behavior:

- chat sessions only
- agent-scoped when cwd resolves to a known agent
- `--limit` is optional; if omitted, return all matching sessions
- output is grouped by session, with agent/provider metadata and full matching turns
- sessions are ordered by `last_active DESC`
- turns inside each session are ordered chronologically

Search formatting rules:

- show all matching turns within a matched session
- keep agent and provider metadata visible so cross-agent and multi-provider
  histories stay unambiguous
- keep transcript display and search indexing separate: transcript output stays
  faithful, while indexing may exclude operational boilerplate such as exact
  heartbeat wrapper prompts and bare `HEARTBEAT_OK`

If nothing matches, print `No matches`.

## `transcript`

`oc session transcript <id-or-prefix>` resolves a session row first, then uses
its stored `provider_id` to select the correct backend adapter.

Current behavior:

- exact full-id match first
- prefix match second
- multiple matches print an ambiguity table and exit 1
- transcript turns are rendered in plain text with a metadata preamble
- `--limit N` applies after transcript parsing and returns the last `N` turns

Transcript formatting rules:

- include only conversational user/assistant turns
- preserve timestamps
- render reply context as `> ...`
- render image-only turns as `[images: N]`
- exclude tool traces, thinking-only content, and compaction plumbing

## Boundaries

```text
src/cli/session.ts
  -> SessionQuery (runtime persistence, read-only)
  -> provider facade readTranscript() selected from stored provider_id
```

This split is deliberate:

- runtime persistence owns session metadata and selector resolution
- backend owns provider transcript parsing and normalization

The CLI must not reuse mutable runtime store constructors for read-only session
queries.

Search-specific indexing, persistence, and transcript-refresh semantics are
owned by `architecture/runtime.md`, not by this CLI document.
