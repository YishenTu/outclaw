---
name: actionbook
description: Browser action engine. Provides up-to-date action manuals for the modern web — operate any website instantly, one tab or dozens, concurrently.
version: 1.4.3
license: MIT
platforms: [macos, linux, windows]
metadata:
  hermes:
    tags: [browser-automation, web-automation, scraping, e2e-testing]
    requires_toolsets: [terminal]
required_environment_variables:
  - name: ACTIONBOOK_API_KEY
    prompt: "Actionbook API key"
    help: "Create one at https://actionbook.dev/dashboard — skill works without it, but requests are rate-limited"
    required_for: "unlimited requests (without a key, public rate limits apply)"
    optional: true
---

## When to Use This Skill

Activate when the user:
- Needs to do anything on a website ("Send a LinkedIn message", "Book an Airbnb", "Search Google for...")
- Asks how to interact with a site ("How do I post a tweet?", "How to apply on LinkedIn?")
- Wants to fill out forms, click buttons, navigate, search, filter, or browse on a specific site
- Wants to take a screenshot of a web page or monitor changes
- Builds browser-based AI agents, web scrapers, or E2E tests for external websites
- Automates repetitive web tasks (data entry, form submission, content posting)
- Needs to operate multiple websites or tabs concurrently

## How It Works

Actionbook provides **up-to-date action manuals** for the modern web. Action manuals tell agents exactly what to do on a page — no parsing, no guessing.

**Why this matters:**
- **10x faster** — action manuals provide selectors and page structure upfront. No snapshot-per-step loop needed.
- **Accurate** — handles SPAs, streaming components, dropdowns, date pickers, and dynamic content reliably.
- **Concurrent** — stateless architecture with explicit `--session`/`--tab`. Operate dozens of tabs in parallel.

The workflow:
1. **Start** a browser session
2. **Navigate** to the target page
3. **Snapshot** to get the page structure with element refs
4. **Automate** using refs from the snapshot

Run `actionbook <command> --help` for full usage and examples of any command.

## Choosing a Browser Mode

Two local modes: **local** (default) and **extension**. Pick based on whether the task needs the user's existing browser state.

### Local mode (default)

Launches a standalone Chromium instance. Clean profile by default, or use `--profile <name>` for persistent cookies/storage across sessions. Best for scraping, testing, and tasks that don't need existing logins.

```bash
actionbook browser start --set-session-id s1                      # clean Chromium
actionbook browser start --set-session-id s1 --profile myprofile  # named profile with persistence
```

### Extension mode (use for authenticated / headed tasks)

Connects to the user's **real Chrome** via a Chrome extension and WebSocket bridge. Gives access to all existing cookies, logins, extensions, and sessions — no re-authentication needed.

```bash
actionbook browser start --mode extension --set-session-id s1 --open-url "https://x.com/home"
```

**When to use extension mode:**
- Task requires existing login sessions (X, Gmail, GitHub, etc.)
- User wants to see and interact with the browser alongside automation
- Site has strict anti-bot detection that a clean Chromium would trigger

**Extension setup (one-time):**
1. `actionbook extension install` — extracts extension to `~/Actionbook/extension/`
2. Chrome → `chrome://extensions/` → enable Developer mode → "Load unpacked" → select `~/Actionbook/extension/`
3. Confirm the Actionbook extension is toggled on

**How the bridge works:**
- The extension connects to the daemon at `ws://127.0.0.1:19222`
- The bridge is **lazy** — it only starts listening when `browser start --mode extension` is run
- `actionbook extension status` showing `bridge: not_listening` is **normal** before any extension session has started
- Once an extension-mode session starts, the bridge activates and the extension auto-connects

**Troubleshooting:**
- `bridge: not_listening` → Expected. Just run `browser start --mode extension ...` to activate.
- Connection fails after start → `actionbook daemon restart`, then retry the start command.
- `bridge: listening` but `extension_connected: false` → In Chrome, toggle the Actionbook extension off/on, or remove and re-load it via "Load unpacked."

## Browser Automation

Every browser command is **stateless** — pass `--session` and `--tab` explicitly. No "current tab" — you can run commands on any session/tab in parallel.

### Start a session

```bash
# Local mode (default — standalone Chromium)
actionbook browser start --set-session-id s1

# Extension mode (real Chrome with existing logins)
actionbook browser start --mode extension --set-session-id s1 --open-url "https://example.com"
```

### Core workflow: snapshot, act, wait

```bash
actionbook browser goto <url> --session s1 --tab t1
actionbook browser snapshot --session s1 --tab t1          # Get page structure with refs
actionbook browser fill @e3 "text" --session s1 --tab t1   # Use refs from snapshot
actionbook browser click @e7 --session s1 --tab t1
actionbook browser wait navigation --session s1 --tab t1   # Wait for page load
```

### Snapshot refs

`snapshot` labels every element with a ref (e.g. `@e3`, `@e7`). Use these refs as selectors in any command — they are the recommended way to target elements.

Refs are **stable across snapshots** — if the element stays the same, the ref stays the same. This lets you chain multiple commands without re-snapshotting after every step.

### Command categories

All commands support `--help` for full usage and examples.

| Category | Key commands | Help |
|----------|-------------|------|
| Session | `start`, `close`, `restart`, `list-sessions`, `status` | `actionbook browser start --help` |
| Tab | `new-tab`, `close-tab`, `list-tabs` | `actionbook browser new-tab --help` |
| Navigation | `goto`, `back`, `forward`, `reload` | `actionbook browser goto --help` |
| Observation | `snapshot`, `text`, `html`, `value`, `title`, `url`, `viewport`, `attr`, `attrs`, `box`, `styles`, `describe`, `state`, `inspect-point`, `screenshot`, `pdf` | `actionbook browser snapshot --help` |
| Interaction | `click`, `fill`, `type`, `press`, `select`, `hover`, `focus`, `scroll`, `drag`, `upload`, `eval`, `mouse-move`, `cursor-position` | `actionbook browser click --help` |
| Wait | `wait element`, `wait navigation`, `wait network-idle`, `wait condition` | `actionbook browser wait element --help` |
| Cookies | `cookies list`, `cookies get`, `cookies set`, `cookies delete`, `cookies clear` | `actionbook browser cookies list --help` |
| Storage | `local-storage list\|get\|set\|delete\|clear`, `session-storage ...` | `actionbook browser local-storage get --help` |
| Logs | `logs console`, `logs errors` | `actionbook browser logs console --help` |
| Network | `network requests`, `network request <id>`, `network har start`, `network har stop` | `actionbook browser network requests --help` |
| Query | `query one\|all\|nth\|count` | `actionbook browser query --help` |
| Batch | `batch-new-tab`, `batch-snapshot`, `batch-click` | `actionbook browser batch-new-tab --help` |
| Extension | `extension status`, `extension ping`, `extension install`, `extension uninstall`, `extension path` | `actionbook extension status --help` |
| Daemon | `daemon restart` | `actionbook daemon restart --help` |

Full command reference: [command-reference.md](references/command-reference.md)

### Cloud providers

Use `-p` / `--provider` with `browser start` to run sessions on a remote browser instead of launching local Chrome. Supported providers: `driver`, `hyperbrowser`, `browseruse`. Each reads its own `<PROVIDER>_API_KEY` from the shell env.

```bash
export HYPERBROWSER_API_KEY="your-key"
actionbook browser start -p hyperbrowser --session s1
actionbook browser goto "https://example.com" --session s1 --tab t1
actionbook browser snapshot --session s1 --tab t1
```

All browser commands work the same way regardless of mode. `browser restart --session <id>` mints a fresh remote session while preserving the session_id.

## Example: End-to-End

User request: "Find a room next week in SF on Airbnb"

```bash
actionbook browser start --set-session-id s1
actionbook browser goto "https://airbnb.com" --session s1 --tab t1
actionbook browser snapshot --session s1 --tab t1
actionbook browser fill @e3 "San Francisco" --session s1 --tab t1
actionbook browser click @e7 --session s1 --tab t1
actionbook browser wait navigation --session s1 --tab t1
```

## Selectors

Selectors should come from `actionbook browser snapshot` — not from prior knowledge or memory. Always snapshot first to get current refs, then use those refs to interact with the page.

## Login Page Handling

When you hit a login/auth wall (sign-in page, password prompt, MFA/OTP, CAPTCHA, account chooser):

1. **Pause automation and keep the current browser session open** (same tab/profile/cookies).
2. **Ask the user to complete login manually** in that same browser window.
3. After user confirms login is done, **continue in the same session**.
4. If the post-login page is different, run `actionbook browser snapshot` to get the new page structure before continuing.

Do not switch tools just because a login page appears.

## References

| Reference | Description |
|-----------|-------------|
| [command-reference.md](references/command-reference.md) | Complete command reference with all flags and options |
| [authentication.md](references/authentication.md) | Login flows, OAuth, 2FA handling, session persistence |
