# App Management: Plugins, Themes, Commands & UI

Use these commands for app-level control (plugins, themes, commands, tabs, workspace).

## Plugins

```bash
# List installed plugins
obsidian plugins

# Include versions
obsidian plugins versions

# Filter by type
obsidian plugins filter=community versions
obsidian plugins filter=core

# Enabled plugins only
obsidian plugins:enabled

# Plugin details
obsidian plugin id=dataview

# Enable / disable
obsidian plugin:enable id=dataview
obsidian plugin:disable id=dataview

# Install / uninstall community plugin
obsidian plugin:install id=obsidian-git enable
obsidian plugin:uninstall id=obsidian-git

# Reload plugin (dev)
obsidian plugin:reload id=my-plugin

# Restricted mode
obsidian plugins:restrict
obsidian plugins:restrict on
obsidian plugins:restrict off
```

## Themes

```bash
# Active theme
obsidian theme

# Installed themes
obsidian themes
obsidian themes versions

# Set / install / uninstall
obsidian theme:set name="Minimal"
obsidian theme:install name="Minimal" enable
obsidian theme:uninstall name="Minimal"
```

## CSS Snippets

```bash
# List snippets
obsidian snippets
obsidian snippets:enabled

# Enable / disable
obsidian snippet:enable name="my-snippet"
obsidian snippet:disable name="my-snippet"
```

## Commands & Hotkeys

```bash
# Command catalog
obsidian commands
obsidian commands filter=editor

# Execute command by id
obsidian command id=app:open-settings

# Hotkeys
obsidian hotkeys
obsidian hotkeys all verbose
obsidian hotkey id=app:open-settings verbose
```

## Templates

```bash
# List templates
obsidian templates
obsidian templates total

# Read template content
obsidian template:read name="Weekly Note"

# Resolve template variables
obsidian template:read name="Weekly Note" resolve title="Week 10"

# Insert into active note
obsidian template:insert name="Weekly Note"
```

## Tabs & Workspace

```bash
# List tabs / include ids
obsidian tabs
obsidian tabs ids

# Workspace tree
obsidian workspace
obsidian workspace ids

# Open new tab
obsidian tab:open file="Work/Plan.md"
obsidian tab:open view="graph"
```

## Notes

- Command options can shift between insider builds. If behavior is odd, confirm options with:
  `obsidian`
- Some app commands require the Obsidian window to be active and responsive.
