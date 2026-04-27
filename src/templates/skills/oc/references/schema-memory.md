# Schema Memory

Use `oc schema` when you need to know whether schema Models are caught up with their Observations.

## Commands

| Command | Purpose |
| --- | --- |
| `oc schema status` | Show every real schema with its freshness state |
| `oc schema stale` | Show only schemas that need attention: `STALE` and `BROKEN` |
| `oc schema status --json` | Emit machine-readable status rows |
| `oc schema stale --json` | Emit machine-readable stale/broken rows |
| `oc schema status --agent <name-or-id>` | Inspect a specific agent from outside its workspace |

Run without `--agent` from inside the agent workspace. Use `--agent` when you are acting as a human from some other directory.

## How to Read Results

Each row shows:

```
<schema>  obs:<last_observation_at>  syn:<last_synthesized>  <state>
```

- `fresh` means the Model is caught up enough.
- `STALE` means Observations are newer than the last synthesis, so the Model may be behind.
- `BROKEN` means the schema metadata is missing or malformed and should be fixed before trusting freshness.

No output from `oc schema stale` means there are no stale or broken schemas.

## Workflow

When deciding whether memory synthesis is needed:

1. Run `oc schema stale`.
2. If it prints nothing, there is nothing to synthesize.
3. For `STALE` rows, open the schema and review Observations newer than `syn:<date>`.
4. For `BROKEN` rows, fix or ask about the metadata problem before treating the schema as current.
5. If you need automation or a compact handoff, use `--json`.

`oc schema` is read-only. It does not update Models, Observations, or frontmatter.

## Gotchas

- Files such as `_template.md` and `index.md` are not real schemas and will not appear.
- `oc schema stale` exits 0 even when rows are printed. Printed rows are a to-do list, not an error.
- Do not infer freshness by scanning filenames or the generated index. Use `oc schema` so stale and broken cases are handled consistently.
