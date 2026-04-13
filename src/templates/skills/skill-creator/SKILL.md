---
name: skill-creator
description: Create or update a skill. Use when the user asks to make a new skill, or when you recognize a repeatable multi-step workflow that should become one.
---

You are the skill creator. Your job is to produce well-structured, provider-neutral skills that any LLM-based agent can execute. For deep reference on any topic below, see the `references/` directory alongside this file.

## Input

$ARGUMENTS — a description of the desired skill, possibly with examples, constraints, or edge cases.

## Procedure

### 1. Clarify intent

If $ARGUMENTS is vague, ask one round of targeted questions: name, trigger condition, inputs, outputs, edge cases. If it's clear enough, skip straight to drafting.

Before writing from scratch, check whether the user has real source material — runbooks, incident reports, code review threads, API docs. Skills grounded in actual expertise outperform those generated from generic knowledge. See [references/best-practice.md](references/best-practice.md) for sourcing strategies.

### 2. Choose a name

The `name` field has strict constraints:

- 1-64 characters
- Lowercase letters, numbers, and hyphens only
- Must not start or end with a hyphen
- No consecutive hyphens (`--`)
- Must match the parent directory name

The name is the slash-command users type (`/my-skill`). Keep it short and descriptive.

### 3. Write the frontmatter

Two fields are required. Optional fields are available but should only be added when genuinely needed.

```yaml
---
name: <skill-name>
description: <what the skill does and when to use it>
---
```

**Required fields:**

| Field         | Constraint        | Purpose                                           |
| ------------- | ----------------- | ------------------------------------------------- |
| `name`        | 1-64 chars        | Identifier, must match directory name              |
| `description` | 1-1024 chars      | Agents read this to decide when to invoke the skill |

**Optional fields** (add only when needed):

| Field           | Purpose                                                    |
| --------------- | ---------------------------------------------------------- |
| `license`       | License name or reference to a bundled license file        |
| `compatibility` | Environment requirements (packages, network access, etc.)  |
| `metadata`      | Arbitrary key-value pairs (author, version, etc.)          |

Do NOT add provider-specific fields (model, tools, thinking, allowed-tools, etc.). Those are runtime concerns, not skill concerns. A skill must be portable: any agent, any provider, any runtime. See [references/specification.md](references/specification.md) for the full spec.

**Writing good descriptions** — the description carries the entire burden of triggering. Guidelines:

- Use imperative phrasing: "Use this skill when..." not "This skill does..."
- Focus on user intent, not implementation details
- Be specific about scope — list the contexts where the skill applies
- Include cases where the user might not name the domain directly
- Keep it under 1024 characters

See [references/optimize-description.md](references/optimize-description.md) for systematic testing.

### 4. Write the instructions

The markdown body after the frontmatter. This is what the agent follows when the skill activates.

**Core principles:**

- **Be imperative.** Write instructions the agent follows, not documentation about the skill.
- **Use `$ARGUMENTS`** as the placeholder for user-provided input at invocation time.
- **One job per skill.** If the workflow has clearly separable phases, split into multiple skills.
- **No provider assumptions.** Describe *what* needs to happen, not *how* a particular provider does it. Don't reference specific tool names, SDK features, or model capabilities.
- **Add what the agent lacks, omit what it knows.** Don't explain common concepts. Focus on project-specific conventions, non-obvious edge cases, and the particular tools or APIs to use.
- **Provide defaults, not menus.** When multiple approaches could work, pick one default. Mention alternatives briefly only as escape hatches.
- **Favor procedures over declarations.** Teach *how to approach* a class of problems, not *what to produce* for a specific instance.
- **Match specificity to fragility.** Give freedom when multiple approaches work. Be prescriptive when operations are fragile or exact sequences matter.

**Effective instruction patterns** (use what fits, skip what doesn't):

- **Gotchas section** — environment-specific facts that defy assumptions. Highest-value content in many skills.
- **Output templates** — concrete structure the agent pattern-matches against. More reliable than prose descriptions. Short templates inline; longer ones in `assets/`.
- **Checklists** — help the agent track progress in multi-step workflows, especially with dependencies.
- **Validation loops** — do work, run validator, fix issues, repeat until passing.
- **Plan-validate-execute** — for batch or destructive operations, create an intermediate plan, validate it, then execute.

See [references/best-practice.md](references/best-practice.md) for detailed examples of each pattern.

**Size targets:**

- Keep `SKILL.md` under 500 lines and ~5000 tokens
- Move detailed reference material to `references/` and tell the agent *when* to load each file
- This is progressive disclosure: metadata (~100 tokens) at startup, instructions on activation, resources on demand

### 5. Create supporting files if needed

```
./skills/<skill-name>/
├── SKILL.md           # Required: instructions + metadata
├── scripts/           # Optional: executable code
├── references/        # Optional: documentation
└── assets/            # Optional: templates, resources
```

**Scripts** — bundle reusable logic the agent would otherwise reinvent each run. Design for agentic use: no interactive prompts, `--help` for usage, structured output (JSON/CSV), helpful error messages, idempotent operations. Prefer self-contained scripts with inline dependencies. See [references/using-scripts.md](references/using-scripts.md) for language-specific patterns.

**References** — keep individual files focused. Use conditional loading: "Read `references/api-errors.md` if the API returns a non-200 status code."

**Assets** — templates, schemas, lookup tables. Reference with relative paths from the skill root.

Use relative paths from the skill directory root for all file references. Keep references one level deep from `SKILL.md`.

Most skills are just a `SKILL.md`. Only create supporting files when genuinely needed.

### 6. Write the skill

Create the directory and files under `./skills/<skill-name>/`.

### 7. Verify

Read back the created SKILL.md and confirm:

- Valid YAML frontmatter with `name` and `description` (plus optional fields only if justified)
- `name` matches directory name and follows naming rules
- `description` is imperative, specific, and under 1024 characters
- Instructions are imperative and provider-neutral
- Uses `$ARGUMENTS` if user input is expected
- Under 500 lines; reference material in separate files if needed
- No provider-specific tool names, SDK features, or model references

Report what you created and how to invoke it (`/<skill-name>`).

## Updating existing skills

When updating rather than creating, follow the same principles but also:

- Read the existing SKILL.md first
- Preserve what works; fix what doesn't
- If the user has execution feedback (failed assertions, transcript issues), use it to guide changes — see [references/evaluating-skills.md](references/evaluating-skills.md)
- Generalize fixes rather than patching for specific cases
