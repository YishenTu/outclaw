# Files, Folders & Search

## Vault & Files

| Command | Description | Key Options |
|---|---|---|
| `vault` | Show vault info | `info=name\|path\|files\|folders\|size` |
| `vaults` | List known vaults | `total`, `verbose` |
| `files` | List files | `folder=<path>`, `ext=<ext>`, `total` |
| `folders` | List folders | `folder=<path>`, `total` |
| `folder` | Show folder info | `path=<path>`, `info=files\|folders\|size` |
| `file` | Show file metadata | `file=<name>`, `path=<path>` |
| `read` | Read file content | `file=<name>`, `path=<path>` |
| `create` | Create a file | `name=<name>`, `path=<path>`, `content=<text>`, `template=<name>`, `overwrite`, `open`, `newtab` |
| `delete` | Delete a file | `file=<name>`, `path=<path>`, `permanent` |
| `move` | Move/rename file (updates wikilinks) | `file=<name>`, `path=<path>`, `to=<path>` |
| `append` | Append content | `file=<name>`, `path=<path>`, `content=<text>`, `inline` |
| `prepend` | Prepend content | `file=<name>`, `path=<path>`, `content=<text>`, `inline` |
| `open` | Open file in app | `file=<name>`, `path=<path>`, `newtab` |
| `random` | Open random note | `folder=<path>`, `newtab` |
| `random:read` | Read random note | `folder=<path>` |
| `reload` | Reload vault | — |
| `restart` | Restart app | — |

## Search

```bash
# Basic text search
obsidian search query="your text"

# Scoped search with highlights
obsidian search query="text" path="Work" limit=10 matches

# Case-sensitive search + JSON output
obsidian search query="text" case format=json

# Search with line context
obsidian search:context query="allocator" limit=5

# Open search pane in Obsidian UI
obsidian search:open query="allocator"
```

Options:
- `query=<text>` (required)
- `path=<folder>`
- `limit=<n>`
- `total`
- `matches` (search only)
- `case`
- `format=text|json`

## Common Workflows

### Move/Rename without breaking links

```bash
obsidian move path="Work/old.md" to="Work/new.md"
```

### Open a note for the user

```bash
obsidian open file="My Note"
# exact path when needed
obsidian open path="Work/My Note.md"
```
