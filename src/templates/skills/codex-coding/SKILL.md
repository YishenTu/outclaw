---
name: codex-coding
description: Use when delegating coding work to Codex through the Bash tool with codex exec in an explicit target repository.
---

# Codex Coding

Run Codex with Bash in the repository that should be edited.

## Command Format

```bash
codex exec --dangerously-bypass-approvals-and-sandbox -C /absolute/path/to/repo "Your coding prompt"
```

Set the Bash tool's run in background parameter to choose foreground or background execution. For foreground delegation, do not set a Bash timeout.
