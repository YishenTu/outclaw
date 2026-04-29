# Metadata, Links & Graph

## Links & Graph Analysis

| Command | Description | Key Options |
|---|---|---|
| `links` | List outgoing links from a file | `file=`, `path=`, `total` |
| `backlinks` | List incoming links to a file | `file=`, `path=`, `counts`, `total`, `format=json\|tsv\|csv` |
| `orphans` | Files with no incoming links | `total`, `all` |
| `deadends` | Files with no outgoing links | `total`, `all` |
| `unresolved` | Unresolved links | `total`, `counts`, `verbose`, `format=json\|tsv\|csv` |
| `aliases` | List aliases | `file=`, `path=`, `active`, `total`, `verbose` |

## Properties (Frontmatter)

```bash
# Vault-wide properties
obsidian properties counts sort=count

# Properties for one file
obsidian properties file="MyNote"

# Read one property value
obsidian property:read name="tags" file="MyNote"

# Set / remove a property
obsidian property:set name="status" value="done" type=text file="MyNote"
obsidian property:remove name="draft" file="MyNote"
```

Options: `file=`, `path=`, `name=`, `active`, `total`, `counts`, `sort=count`, `format=yaml|json|tsv`

## Tags

```bash
# Vault-wide tags
obsidian tags counts sort=count

# Tags for one file
obsidian tags file="MyNote"

# Single tag details
obsidian tag name="ai" verbose
```

Options: `file=`, `path=`, `active`, `total`, `counts`, `sort=count`, `format=json|tsv|csv`

## Tasks

```bash
# Vault-wide tasks
obsidian tasks

# Filter tasks
obsidian tasks todo
obsidian tasks done
obsidian tasks status="!"

# Tasks for one file
obsidian tasks file="MyNote"

# Toggle/update task status
obsidian task file="MyNote" line=15 toggle
obsidian task file="MyNote" line=15 done
obsidian task file="MyNote" line=15 todo
```

Options: `file=`, `path=`, `active`, `daily`, `total`, `done`, `todo`, `status="<char>"`, `verbose`, `format=json|tsv|csv`

## Bookmarks

```bash
obsidian bookmarks
obsidian bookmark file="Work/Plan.md"
obsidian bookmark url="https://example.com" title="Example"
```

## Outline & Word Count

```bash
obsidian outline file="MyNote"
obsidian outline file="MyNote" format=md
obsidian wordcount file="MyNote"
```

## Recents

```bash
obsidian recents
obsidian recents total
```

## Bases

```bash
# List base files
obsidian bases

# Query base (prefer path=)
obsidian base:query path="Bases/AI.base" format=md
obsidian base:query path="Bases/AI.base" format=json

# List views in a base
obsidian base:views path="Bases/AI.base"

# Create row/item in a base view
obsidian base:create path="Bases/AI.base" view="Projects" name="New Entry" content="Some content" open
```

Formats: `json|csv|tsv|md|paths`
