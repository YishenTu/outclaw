---
name: obsidian-cli
description: Interact with the running Obsidian app via its CLI. Use when the user wants to move/rename files (updates wikilinks atomically), query link graph (backlinks, orphans, deadends, unresolved/broken links), list/query tags or tasks, set/remove frontmatter properties, query bases, open files in Obsidian UI, run Obsidian commands, manage plugins/themes/snippets, view file history/sync versions, resolve templates, or perform any operation requiring live Obsidian state. Trigger phrases include "rename note", "move file", "find orphans", "broken links", "backlinks", "set property", "open in obsidian", "list tags", "vault info", "run command", "manage plugin", "base query", "resolve template", etc.
---

# Obsidian CLI Skill

Control a running Obsidian instance (v1.12+) from the terminal. The CLI talks to the live app, so results reflect real-time vault state (resolved links, plugin data, base views, etc.) that plain file reads cannot provide.

## When to Use the CLI (vs Built-in Tools)

The CLI talks to the live Obsidian app. Only use it for things built-in tools (Read, Write, Edit, Glob, Grep) cannot do or would do poorly. Every CLI call has app-roundtrip overhead, so default to built-in tools and reach for the CLI only when it adds real value.

### High value — use the CLI

These commands do things built-in tools cannot replicate reliably:

- `move` / `rename` — atomically updates all wikilinks across the vault. Bash `mv` + Grep link fixups is brittle.
- `backlinks`, `links`, `orphans`, `deadends`, `unresolved` — graph queries using Obsidian's resolved link index (case-insensitive, alias-aware, heading links). Grep is fragile.
- `tags` / `tag` — vault-wide indexed tag aggregation with counts; distinguishes frontmatter from inline tags, handles nested tags.
- `tasks` / `task` — vault-wide task collection with status filtering; `task` toggle respects custom statuses and plugin interactions.
- `bases` / `base:query` / `base:views` / `base:create` — `.base` is a proprietary format; CLI is the only programmatic access.
- `open` / `tab:open` — UI control (open files, switch tabs). No built-in equivalent.
- `command` — execute any Obsidian command (toggle dark mode, open graph view, etc.).
- `history` / `history:read` / `history:restore` — internal recovery storage, inaccessible from filesystem.
- `sync:*` — sync management, internal state.
- `template:read` (with `resolve`) — resolves `{{date}}`, `{{title}}` variables; raw Read gives unresolved source.
- `plugins` / `plugin:*` — full plugin lifecycle management.
- `themes` / `theme:*` — theme management.
- `snippets` / `snippet:*` — CSS snippet management.
- `property:set` / `property:remove` — modifies frontmatter through Obsidian's API with guaranteed correct YAML formatting.

### Moderate value — CLI is convenient but replicable

- `search` / `search:context` — indexed and metadata-aware, but Grep handles plain text well and is faster.
- `properties` (vault-wide) — aggregates all frontmatter properties with counts. Doable with Grep + parsing but tedious.
- `vault` — quick vault stats. We can count files ourselves.
- `outline` — heading extraction. Parsing `#` lines is trivial.
- `bookmarks` / `bookmark`, `recents` — Obsidian internal state; useful occasionally.
- `reload` — useful after our Write/Edit changes so the app picks them up.
- `diff` — version comparison; useful but infrequent.
- `hotkeys` / `hotkey`, `commands` (listing), `workspace`, `tabs` — informational, read-only.
- `aliases` — less frequent need.
- `random` / `random:read` — niche.

### Do NOT use — use built-in tools instead

These CLI commands are strictly redundant. Built-in tools are faster and more precise:

- `read` → use **Read** tool (faster, supports images/PDFs, no app overhead).
- `create` → use **Write** tool.
- `append` / `prepend` → use **Edit** tool.
- `delete` → use **Bash** `rm` (CLI version uses trash, which is marginally safer).
- `files` / `folders` / `folder` / `file` → use **Glob** or `ls`.
- `property:read` → just **Read** the file and parse frontmatter.
- `search:open`, `template:insert`, `templates` (listing) → rarely needed; Glob the templates folder instead.
- `help`, `version`, `vaults`, `restart` — one-off or troubleshooting only.

## Invocation

Use this command shape:

```bash
obsidian <command> [options]
```

The `obsidian` binary is on PATH and can be invoked directly — no interactive shell needed.

To target a specific vault (when multiple vaults exist), prefix with `vault=<name>`:

```bash
obsidian vault="My Vault" <command>
```

## Important Notes

### file= vs path=

Many file-scoped commands accept either `file=<name>` (fuzzy match by display name) or `path=<path>` (exact vault-relative path).

- Prefer `file=` by default (works better with spaces, punctuation, Chinese names).
- Use `path=` only when disambiguation is required.
- `base:query` generally needs `path=` to the `.base` file.

### Command discovery

The CLI shares the GUI binary (`/Applications/Obsidian.app/Contents/MacOS/obsidian`). It IPC-connects to the running app instance, so:

**The CLI requires the Obsidian app to be running.** Subcommands fail (typically with `Unable to connect to main process`) if the app is not up — or if a previous crash/forced-kill left a stale singleton-lock file at `~/Library/Application Support/obsidian/SingletonLock`.

**Discover commands via `obsidian help`** (full 457-line catalog of ~98 commands and their options). Bare `obsidian` produces the same output but does not exit cleanly — the process stays alive holding the GUI handle. `obsidian help` exits as expected.

**There is no `-h` flag.** Skip it; use `obsidian help` or pipe `obsidian help | grep <command>` for quick lookup.

**Subcommand exit behavior**: real subcommands like `obsidian vault`, `obsidian tags` return in well under 1s with proper exit codes — they do not hang. If a subcommand appears to hang, it usually means the singleton lock is stale; quit & relaunch the app.

### General

- Commands that operate on the "current file" require an active note unless `file=` / `path=` is provided.
- Most list commands are vault-wide by default (`tags`, `tasks`, `properties`, etc.). Do **not** assume an `all` flag exists.
- Output is usually TSV/plain text unless a `format=` option is provided.
- Some commands may print updater logs before command output; filter those lines for parsing.

### Error Handling

Common errors:
- `Error: File "name" not found.` — file doesn't exist or fuzzy match failed.
- `Error: No active file. Use file=<name> or path=<path> to specify a file.` — no active note and no explicit target.
- `Error: Missing required parameter: <param>` — required option omitted.
- `Error: Base file not found: <name>` — pass `path=` to `.base` file instead of `file=`.
- `Failed to create ... SingletonLock: File exists (17)` / `Unable to connect to main process` — Obsidian app is not running cleanly. Quit the app, remove the stale lock (`rm ~/Library/Application\ Support/obsidian/SingletonLock`), then relaunch with `open -a Obsidian` and retry.

## Reference Files

Read one focused reference file based on task:

| Task involves | Read |
|---|---|
| Vault info, files, folders, search, create, move, delete, read, append/prepend, open | `ref/ref-files-and-search.md` |
| Properties, tags, links, backlinks, orphans, deadends, unresolved, aliases, tasks, bookmarks, outline, wordcount, bases, recents | `ref/ref-metadata.md` |
| Plugins, themes, snippets, commands, hotkeys, tabs, workspace, templates | `ref/ref-app.md` |
| File history, versions, diff, sync | `ref/ref-history.md` |
| dev:*, eval, devtools, screenshots, DOM, CSS inspection, console | `ref/ref-dev.md` |
| Need authoritative full command/option list for current build | `ref/ref-command-catalog-1.12.5.md` |

All reference files are in the `ref/` subdirectory relative to this SKILL.md.
