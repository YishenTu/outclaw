---
name: skill-finder
description: Use when the user wants to discover, examine, or evaluate agent skills from the open Agent Skills ecosystem (skills.sh / Vercel Labs) as references for building their own. Triggers on phrases like "find a skill for X", "is there a skill that does Y", "show me skills about Z", "what's on skills.sh", "look up <skill-name>", "what does the <X> skill do". The skill enforces a fit-first workflow — clarify intent, search, fetch SKILL.md, assess fit against the user's actual need, and adapt via `/skill-creator`. Never auto-installs; the goal is learn-and-adapt, not install-and-use.
---

# skill-finder

Find skills on [skills.sh](https://skills.sh/), but only as **references for building the user's own**. The default outcome of this skill is a custom SKILL.md drafted via `/skill-creator`, informed by what already exists — not a third-party skill installed verbatim.

## Why this matters

A skill written for a generic Claude Code user almost always has seams: assumptions about file paths, agent names, tool availability, project layout. Installing it raw drags those seams into this workspace. Worse, a vague keyword match ("git workflow") can surface a skill that *looks* relevant but solves a different sub-problem than the user actually has.

So the workflow below is fit-first, not search-first. Skip steps only when the user has explicitly already done them.

## Workflow

### Step 1 — Clarify intent (always)

Before searching, confirm the user's actual need in one or two questions. Aim for a sentence that distinguishes between near-neighbor problems. Useful axes:

- **What trigger fires the skill?** (a slash command? a class of user request? an automation?)
- **What is the input?** (free-text, a file path, a structured object?)
- **What is the output?** (a written artifact, a side effect, a decision, a search result?)
- **What's the surrounding workflow?** (one-off vs. recurring; does it chain into another skill?)

Bad clarification: "What kind of git workflow?" (too open).
Good clarification: "Are you looking for something that drafts commit messages from a diff, or something that opens/reviews PRs end-to-end?"

If the user gave a precise need up front, skip this step — don't interrogate. Use judgment.

### Step 2 — Search (Tier 1, cheap)

Run `npx skills find <query>` and parse the plain-text rows.

```
npx -y skills find <query> 2>&1
```

Output rows look like:

```
microsoft/github-copilot-for-azure@azure-observability  115.5K installs
└ https://skills.sh/microsoft/github-copilot-for-azure/azure-observability
```

Each block is `<owner>/<repo>@<skillId>` + `<N> installs` + skills.sh URL. The CLI returns up to ~100 results. Rank top 5–10 by relevance to the *clarified* need (not the raw query) and install count. Do not dump all rows.

Fallback if the CLI fails: `GET https://skills.sh/api/search?q=<query>&limit=20` returns `{skills: [{id, skillId, name, installs, source}, ...]}`.

Present candidates concisely:

```
For "draft commit messages from diff", top candidates:

1. github/awesome-copilot@git-commit  (28K)
   https://skills.sh/github/awesome-copilot/git-commit

2. <next>  ...

Want me to fetch and assess the top one, or look broader?
```

### Step 3 — Fetch SKILL.md (Tier 2, medium)

When the user picks a candidate (or asks for a preview), fetch the raw `SKILL.md` from GitHub. The CLI does not expose descriptions — only GitHub does.

Try paths in order against `https://raw.githubusercontent.com/<owner>/<repo>/HEAD/<path>`:

1. `<skillId>/SKILL.md`
2. `skills/<skillId>/SKILL.md`
3. `.claude/skills/<skillId>/SKILL.md`
4. `agents/<skillId>/SKILL.md`
5. `SKILL.md` (root, for single-skill repos like `vercel-labs/agent-skills`)

Stop at the first 200 response. Read the full file — frontmatter and body. Don't summarize blindly yet; the assessment in Step 4 needs the full text.

If all five paths 404, list the repo's tree via `GET https://api.github.com/repos/<owner>/<repo>/git/trees/HEAD?recursive=1` and grep for `SKILL.md` entries.

### Step 4 — Assess fit (the actual point of this skill)

This is the step that distinguishes a useful match from a vague one. Read the fetched SKILL.md against the user's clarified need from Step 1, and answer **explicitly**:

| Dimension | Question |
|---|---|
| **Trigger overlap** | Does the skill activate on the same kind of user request? |
| **Input shape** | Does it expect the same kind of input the user has? |
| **Output shape** | Does the output match what the user wants to produce? |
| **Assumptions** | What does it assume about the environment (paths, tools, agent name, conventions)? Which of those are wrong here? |
| **Workflow fit** | Does it chain naturally into how the user works, or does it import a different mental model? |
| **Verdict** | One of: **strong fit** (rare — adapt minimally), **partial fit** (common — borrow the structure, rewrite the specifics), **weak fit** (skip — don't let install-count justify a bad match). |

Surface this assessment to the user as a brief written judgment, not a checkbox table. Lead with the verdict. Example:

> **Partial fit.** This skill drafts commit messages from `git diff --staged`, which matches your trigger. But it assumes a Conventional Commits style and writes scope tags (`feat:`, `fix:`) — your repos use plain prose. The structure (one-shot diff → message → user confirms before commit) is worth borrowing; the formatting rules aren't.

If multiple candidates were promising, repeat Steps 3–4 for the next one.

### Step 5 — Adapt, don't install

The default next move is **always** `/skill-creator`. Frame it that way explicitly:

> Want to use `/skill-creator` to draft your own version, taking the [structure / trigger framing / step model] from this one and dropping the parts that don't fit?

Only deviate if:

- The user explicitly asks "just install it as-is" — then follow the **manual install procedure** below and warn about the seams found in Step 4.
- The verdict in Step 4 was **weak fit** for everything searched — then loop back to Step 1 and reclarify, or tell the user honestly that nothing on skills.sh matches and they should write from scratch.

#### Manual install procedure (opt-in only)

**Do not run `npx skills add <package>` to install.** The CLI installs into `.claude/skills/`, `.agents/skills/`, or other agent-specific paths. outclaw uses `<agent-workspace>/skills/<skillId>/` (e.g. `~/.outclaw/agents/<name>/skills/`) — none of the CLI's targets. Use the manual flow:

1. Resolve the target dir. Default to `<current agent workspace>/skills/<skillId>/`. If the current working directory isn't an agent workspace, ask the user which agent to install into.
2. Clone the source repo to a tempdir:
   ```
   git clone --depth 1 https://github.com/<owner>/<repo>.git /tmp/skill-finder-<rand>
   ```
3. Locate the skill folder inside the clone using the same path candidates as Step 3 (`<skillId>/`, `skills/<skillId>/`, `.claude/skills/<skillId>/`, `agents/<skillId>/`, or repo root).
4. Move that folder to the target, renaming to `<skillId>` if needed:
   ```
   mv /tmp/skill-finder-<rand>/<found-path> <agent-workspace>/skills/<skillId>
   ```
   Use `mv`, not `cp` — leaves no stale copy behind. If the source folder is the repo root (single-skill repo), copy the SKILL.md and any sibling `scripts/`, `references/`, `assets/` directories, but skip `.git/`, `package.json`, `node_modules/`, etc.
5. Clean up the tempdir:
   ```
   rm -rf /tmp/skill-finder-<rand>
   ```
6. Confirm to the user: report the final path, list any seams from Step 4 they should fix manually, and remind them to commit if the workspace is git-tracked.

## Tier 3 — Browse a whole collection (rare)

Only when the user explicitly wants a category survey across a multi-skill repo (e.g. `github/awesome-copilot` has 328 skills):

```
npx -y skills add <owner/repo> -l 2>&1
```

This **clones the full repo** and prints every skill name + description. Expensive (network + disk) and produces noisy TUI output. Use sparingly; prefer Tier 1 search for keyword matches.

## Identity gotcha

| Context | Format | Example |
|---|---|---|
| skills.sh URL | `<owner>/<repo>/<skillId>` | `https://skills.sh/github/awesome-copilot/git-commit` |
| `npx skills add` | `<owner/repo>@<skillId>` | `github/awesome-copilot@git-commit` |
| GitHub repo | `<owner>/<repo>` | `https://github.com/github/awesome-copilot` |

Use `@` when constructing install commands; `/` everywhere else.

## Do not

- **Do not skip Step 1 (clarify) for vague requests.** "Find a skill for git" without follow-up almost always wastes the user's time on weak matches.
- **Do not skip Step 4 (assess).** Surfacing a SKILL.md without judgment turns this skill into a search box, which is the failure mode this design exists to prevent.
- **Do not run `npx skills add <package>`** to install — ever. The CLI's install targets (`.claude/skills/`, `.agents/skills/`) are incompatible with outclaw's layout. If the user opts in to install, use the manual procedure in Step 5.
- **Do not infer quality from install count.** Microsoft and GitHub repos dominate every search; smaller, better-fitting skills sit lower. Weight the user's clarified need first, install count as a tiebreaker only.
- **Do not dump all 100 results.** Summarize, rank, offer to drill in.

## Gotchas

- `npx -y skills` adds a few seconds of cold-start on first run as npm fetches the package. Subsequent calls in the same shell are cached.
- The `skills find` plain-text output uses ANSI color codes. Strip them when parsing (`sed 's/\x1b\[[0-9;]*m//g'` or equivalent) if comparing strings.
- Some repos store SKILL.md at non-standard paths. If all five Step 3 paths return 404, fall back to the GitHub tree API rather than guessing further.
- skills.sh is a Next.js leaderboard; only `/api/search` is a stable public contract. Ranking pages (trending/hot) are RSC-only and break on redeploys. Don't depend on them.
