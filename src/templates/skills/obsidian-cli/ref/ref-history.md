# History, Versions & Sync

Use these commands for local history, sync history, and version restore workflows.

## Local history (File Recovery)

```bash
# Files that have history
obsidian history:list

# Show versions for a note
obsidian history file="MyNote"

# Read one version
obsidian history:read file="MyNote" version=1

# Restore one version
obsidian history:restore file="MyNote" version=1

# Open File Recovery UI
obsidian history:open file="MyNote"
```

## Diff

```bash
# Show local+sync version references
obsidian diff file="MyNote"

# Local-only or sync-only refs
obsidian diff file="MyNote" filter=local
obsidian diff file="MyNote" filter=sync

# Compare two version numbers (when applicable)
obsidian diff file="MyNote" from=2 to=6
```

## Sync

```bash
# Sync status
obsidian sync:status

# Pause / resume sync
obsidian sync off
obsidian sync on

# Sync version history for a note
obsidian sync:history file="MyNote"
obsidian sync:history file="MyNote" total

# Read / restore sync version
obsidian sync:read file="MyNote" version=1
obsidian sync:restore file="MyNote" version=1

# Deleted files in sync
obsidian sync:deleted

# Open sync history UI
obsidian sync:open file="MyNote"
```

## Notes

- If sync is not configured, `sync:status` returns disconnected / not set up.
- For automation, prefer explicit `file=`/`path=` and explicit `version=`.
- Restore operations are destructive to current content state; confirm intent before applying.
