---
name: handoff
description: Generate a handoff document in dev/HANDOFF.md summarizing decisions made in the current session — what was taken, what was dropped, and what was implemented.
---

Generate a concise handoff document at `dev/HANDOFF.md` for the topic: **$ARGUMENTS**

The handoff captures decisions made during this conversation so future sessions have context. Structure it as:

## `dev/HANDOFF.md`

```
# Handoff

## <Topic>

### What Was Taken
Items from the design spec that were implemented, with a one-line note on what was done.

### What Was Dropped
Items from the design spec that were deliberately skipped, with a one-line reason why.

### What Was Implemented
The concrete result — schema, code structure, or interface — as a code block or short description.
```

## Rules

1. Read the relevant design specs in `dev/design-spec/` to understand what was originally planned.
2. Review `git diff` or recent changes to see what was actually built.
3. Keep each section to 3-5 bullet points max. One line per item.
4. If `dev/HANDOFF.md` already exists, overwrite it — each handoff replaces the previous one.
5. No architecture explanations, no rationale essays. Just the facts.
