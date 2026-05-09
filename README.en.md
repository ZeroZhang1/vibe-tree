# Vibe Tree

[简体中文](README.md) | English

Vibe Tree is a tiny desktop companion for vibe coding. It turns local coding-agent token usage into a floating weather tree:

- Total XP drives the tree's level and growth stage.
- Recent XP/min drives the desktop weather.
- The bonsai lives in a transparent always-on-top window.
- A manager window shows usage, sources, history, and settings.

## Quick Start

macOS, Linux, and Windows:

```bash
npm install
npm start
```

Development mode:

```bash
npm run dev
```

Validation:

```bash
npm run typecheck
npm run build
```

## Current Scope

This first version focuses on making local usage tracking dependable and pleasant to keep running:

- Floating Electron pet window: transparent, draggable, lockable, and always-on-top.
- Electron manager window: level, weather, active sessions, source stats, and recent 7-day usage.
- Device-level settings: bonsai size, lock/always-on-top, launch on startup, silent startup, and source path overrides.
- Tray status panel for quick app status and controls.
- Manual feeding for testing growth and weather feedback.
- Automatic usage import from local Codex, Claude Code, OpenClaw, and OpenCode session files.

## XP Rules

Vibe Tree tracks real agent usage as:

```text
XP = inputTokens + outputTokens
```

`cacheReadTokens` and `cacheWriteTokens` are stored for source details, but they are not counted as XP.

By default, the bonsai starts counting from the app's install day. Session history before that day is ignored so a new install does not immediately inherit old usage.

## Source Watchers

The app reads local session files from the current system user directory.

Codex:

```text
macOS:   ~/.codex/sessions/**/*.jsonl
Windows: %USERPROFILE%\.codex\sessions\**\*.jsonl
```

Claude Code:

```text
macOS:   ~/.claude/projects/**/*.jsonl
Windows: %USERPROFILE%\.claude\projects\**\*.jsonl
```

OpenClaw:

```text
macOS:   ~/.openclaw/agents/**/sessions/*.jsonl
Windows: %USERPROFILE%\.openclaw\agents\**\sessions\*.jsonl
```

OpenCode:

```text
macOS:   ~/.local/share/opencode/storage/message/**/*.json
Windows: %LOCALAPPDATA%\opencode\storage\message\**\*.json
```

Source paths can also be overridden from the manager window.

### Optional History Import

To force-import today's history on startup, use these environment variables.

macOS / Linux:

```bash
VIBE_CODEX_IMPORT_HISTORY=today \
VIBE_CLAUDE_IMPORT_HISTORY=today \
VIBE_OPENCLAW_IMPORT_HISTORY=today \
VIBE_OPENCODE_IMPORT_HISTORY=today \
npm start
```

Windows PowerShell:

```powershell
$env:VIBE_CODEX_IMPORT_HISTORY="today"
$env:VIBE_CLAUDE_IMPORT_HISTORY="today"
$env:VIBE_OPENCLAW_IMPORT_HISTORY="today"
$env:VIBE_OPENCODE_IMPORT_HISTORY="today"
npm start
```

## Assets

The runtime currently uses the confirmed pure-SVG pixel bonsai assets:

```text
public/assets/trees/vibe-bonsai/
  config/
    game-balance.json
    pure-svg-manifest.json
  pure-svg/
    01-sprout-layered-idle.svg
    02-seedling-layered-idle.svg
    03-young-layered-idle.svg
    04-medium-layered-idle.svg
    05-lush-layered-idle.svg
    06-full-layered-idle.svg
```

Old PNGs, image-generation candidates, experimental preview pages, and visual checkpoints are not part of the current runtime path.

## Game Balance

Growth, weather, and activity windows are configured here:

```text
public/assets/trees/vibe-bonsai/config/game-balance.json
```

It contains:

- XP level curve: `levelBase`, `levelExponent`, `maxLevel`
- Weather thresholds by `minXpPerMinute`
- Growth stage thresholds by `minLevel`
- Activity windows for recent and peak usage

## Persistence

Electron stores local app data in its user data directory. In development this may be the default Electron app data path, while packaged builds should use the app's own identity.

The app writes:

- `usage-events.jsonl`: append-only usage event store
- `usage-meta.json`: install date and usage metadata
- `device-settings.json`: machine-local settings
- `codex-session-watcher.json`: Codex watcher offsets and state
- `claude-session-watcher.json`: Claude watcher offsets and state
- `openclaw-session-watcher.json`: OpenClaw watcher offsets and state
- `opencode-session-watcher.json`: OpenCode watcher offsets and state

## Product Direction

Vibe Tree is not meant to be just another token dashboard. The goal is to make the cost, rhythm, and activity of vibe coding feel visible through a small desktop companion. The first version prioritizes reliable local ingestion for Codex, Claude Code, OpenClaw, and OpenCode; future work can continue improving the pet behavior, weather feedback, packaging, and game balance.
