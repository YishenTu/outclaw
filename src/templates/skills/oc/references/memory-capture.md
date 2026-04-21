# Memory Capture

`oc note` is the write primitive for the memory system. It appends an observation to today's `daily-memories/YYYY-MM-DD.md` with session attribution. The tool handles stanza insertion, timestamping, and cross-session locking, so the agent never touches daily-memory files directly.

## Usage

```
oc note "<content>"                         # short note
oc note --salience <tag> "<content>"        # tag the observation
oc note --hint <schema> "<content>"         # note-to-self for the routing cron
oc note <<'EOF'                             # multi-line via stdin / heredoc
line one
line two
EOF
```

Flags can combine. Content must come from a positional argument OR stdin — not both. Passing both exits with an error.

## Flags

| Flag | Purpose | Default |
| --- | --- | --- |
| `--salience <tag>` | Salience tag on the entry | `routine` |
| `--hint <schema>` | Schema name the observation most belongs to | none |

### Salience vocabulary (closed set)

| Tag | Use for |
| --- | --- |
| `correction` | User corrected the agent's approach or a prior belief |
| `confirmation` | Non-obvious agent choice was accepted without pushback |
| `decision` | A choice was made that shapes future work |
| `surprise` | Something unexpected — error, discovery, contradiction |
| `routine` | Ordinary observation that belongs on the log |

Unknown salience values are rejected with an error. Add to the vocabulary through a spec update — don't pass anything else.

### Hint semantics

`--hint <schema>` records a note-to-self on the observation line as `[[schema]]`. The routing cron uses it as input when fanning observations into schemas, but it is advisory — the cron agent may override it. The outclaw runtime does not act on hints at all.

Pick a hint when the target schema is obvious at write time (e.g., `--hint project_outclaw` when clearly talking about outclaw). Omit when uncertain.

## Output shape in the daily note

```
## Session <id> | HH:MM

- HH:MM [<salience>] <content> [[<hint>]]
```

Multi-line content produces a single bullet with indented continuation lines:

```
- 14:32 [routine] first line
  second line
  third line
```

The `- ` line is still the addressable observation; continuation lines belong to that entry.

## Session attribution

`oc note` reads `OC_SESSION_ID` and `OC_MEMORY_ROOT` from its environment. Both are injected by the outclaw runtime when it spawns the agent, so the CLI just works from inside an agent session. If either is missing, the command errors out (`oc note: must run inside an outclaw-managed agent session`) rather than silently writing to the wrong place.

A conversation's observations share one `## Session` stanza — `OC_SESSION_ID` stays stable across resumed runs of the same SDK session. A new conversation (or a new cron invocation) produces a new stanza.

## Gotchas

- Passing both a positional argument and piped stdin is an error. Pick one.
- Whitespace-only content is rejected.
- Running `oc note` outside an outclaw-managed session is rejected — no fallback location.
- The tool locks the daily file with a short-held advisory lock. Concurrent sessions serialize automatically; parallel writes do not fragment the file.
