# Session Lookup

## Commands

| Command | Purpose |
| --- | --- |
| `oc session list` | List chat sessions (scoped to current agent when run from an agent workspace) |
| `oc session list --tag cron` | List cron sessions |
| `oc session list --limit N` | Show N most recent sessions (default: 20) |
| `oc session search <query>` | Find past chat sessions by keyword |
| `oc session search <query> --limit N` | Show up to N matching sessions (default: all matches) |
| `oc session transcript <id-or-prefix>` | Print a past conversation transcript with timestamps |
| `oc session transcript <id-or-prefix> --tag cron` | Read a cron session transcript |
| `oc session transcript <id-or-prefix> --limit N` | Show only the last N turns of the transcript |

Flags can be combined: `oc session list --limit 50 --tag cron`.

## Workflow

Think of `search` and `transcript` like `grep` and `cat` — search finds *where* something was discussed, transcript lets you read the full context. The process is iterative, not one-shot:

1. **Search** by keyword to find which sessions mentioned a topic.
2. **Inspect** the matching turns in the search output — they're snippets, not full context.
3. **Open the transcript** of a promising session to read the surrounding discussion.
4. **Repeat** — refine the query, try different keywords, or check another match until you have enough information.

`list` is useful when you don't have a keyword — browse recent session titles and timestamps to orient before searching.

If the user references a past or different session, use `oc session` rather than guessing from memory.

**Example**: the user asks "what did we decide about the retry logic?"

```
oc session search "retry logic"           # find sessions that mention both words
# output shows 3 sessions with matching turn snippets
oc session transcript abc12345 --limit 20  # read the most relevant match
# the decision isn't in this session — it just mentions retry in passing
oc session transcript def67890 --limit 30  # check the next match
# found: the decision was to use exponential backoff with 3 retries
```

## Search Behavior

- Queries use **AND** semantics: `webhook stripe` matches turns containing **both** words.
- Tokens are matched as whole words: `web` will **not** match `webhook`. Use the full word.
- Search only covers **chat** sessions. Cron sessions are not searchable — use `oc session list --tag cron` and inspect transcripts directly.
- Output shows each matching session with agent/provider metadata and the specific turns that matched, not just titles. Use this to decide whether to open the full transcript.
- Excludes exact heartbeat wrapper prompts and bare `HEARTBEAT_OK` replies, but keeps substantive heartbeat discussion.
- Returns all matches unless `--limit` is passed. Add `--limit` when you want a smaller, faster-to-scan result set.
- If a keyword doesn't match, broaden the query — try synonyms or related terms rather than substrings.

## Scoping and IDs

- Sessions are scoped to the current agent. To inspect another agent's sessions, `cd` into their workspace first — but only do this when the user explicitly asks.
- Cron runs are stored separately with `tag = cron` and are not normal chat sessions.
- `oc session list` defaults to 20 results. Use `--limit` when the user wants to see more.
- The `id` shown by `oc session list` is a readable prefix of the full durable session ID.
- If `oc session transcript` reports multiple matches, rerun with a longer prefix or the full ID.
