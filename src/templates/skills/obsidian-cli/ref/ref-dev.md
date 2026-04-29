# Developer Tools

These commands support plugin development, runtime inspection, and debugging.

## Debugger lifecycle

Some dev commands require debugger attachment first.

```bash
# Attach debugger (required before dev:console/dev:errors in many builds)
obsidian dev:debug on

# Detach debugger
obsidian dev:debug off
```

## Console & errors

```bash
# Read captured console logs
obsidian dev:console limit=20
obsidian dev:console level=error

# Clear console buffer
obsidian dev:console clear

# Captured errors
obsidian dev:errors
obsidian dev:errors clear
```

If you see `Debugger not attached`, run `dev:debug on` first.

## DOM / CSS inspection

```bash
# Query elements
obsidian dev:dom selector=".workspace-leaf" total
obsidian dev:dom selector=".workspace-leaf" text
obsidian dev:dom selector=".nav-file-title" attr="data-path"

# CSS with source info
obsidian dev:css selector=".workspace-leaf" prop="background-color"
```

## CDP / Eval / DevTools

```bash
# Run JS in Obsidian context
obsidian eval code="app.vault.getFiles().length"

# Run raw CDP method
obsidian dev:cdp method="Page.captureScreenshot"
obsidian dev:cdp method="Runtime.evaluate" params="{\"expression\":\"2+2\"}"

# Toggle Electron DevTools UI
obsidian devtools
```

## Screenshots & mobile emulation

```bash
# Screenshot
obsidian dev:screenshot path="obsidian.png"

# Mobile emulation
obsidian dev:mobile on
obsidian dev:mobile off
```

## Notes

- Dev commands are sensitive to app focus/state and may return empty data if no target pane is active.
- For script workflows, keep `dev:debug on` within the same sequence before log/error inspection.
