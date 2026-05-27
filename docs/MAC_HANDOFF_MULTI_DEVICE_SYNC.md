# Mac Handoff: Multi-device Tree Sync

Date: 2026-05-27
Branch: `codex/multi-device-tree-sync`

This branch is a handoff snapshot for continuing real multi-device Vibe Tree sync on a Mac.

## Product Goal

The desired user flow is:

1. A first-time user chooses either `Grow a new tree` or `Continue existing tree`.
2. `Grow a new tree` starts a local tree and can optionally enable cloud sync later.
3. `Continue existing tree` signs in with the same GitHub account, pulls the cloud tree archive, and keeps growing the same tree across Windows and macOS.
4. Sync must not upload prompts, replies, code, files, local paths, or session contents.

The synced payload should stay limited to:

- Token ledger events.
- A local device id.
- Achievement unlock state.

## Current State

This branch adds the first implementation pass for cloud tree sync:

- `LedgerEntry` now supports `deviceId`.
- `Settings` now includes:
  - `cloudSyncEnabled`
  - `cloudSyncDeviceId`
  - `cloudSyncLastSyncedAt`
  - `cloudSyncLastPulledAt`
  - `treeStartMode`
- Electron main process writes a stable device id and tags new usage events with it.
- Electron main process can append remote ledger entries and merge remote achievement unlocks.
- Preload and renderer expose cloud sync IPC:
  - `getCloudSyncStatus`
  - `startNewTree`
  - `enableCloudSync`
  - `joinExistingTree`
  - `syncCloudTree`
- Renderer has a first-run choice modal and a settings panel section named `One tree, many devices`.
- Cloudflare Worker has new routes:
  - `GET /api/tree`
  - `POST /api/tree/events`
  - `POST /api/tree/achievements`
- D1 schema has new tables:
  - `tree_events`
  - `tree_achievements`

## Important Files

- `src/shared/types.ts`
  Shared types for cloud status, settings, and device-tagged ledger entries.

- `src/electron/main.ts`
  Owns local ledger loading, first-run migration, device id creation, IPC handlers, and remote merge.

- `src/electron/leaderboard.ts`
  Existing leaderboard service now also performs cloud tree sync through the same GitHub auth session.

- `src/electron/preload.ts`
  Typed renderer bridge for cloud sync IPC.

- `src/electron/preload.cjs`
  Runtime preload bridge. Keep this in sync with `preload.ts`.

- `src/renderer/appShell.ts`
  Adds the first-run modal and cloud sync settings UI.

- `src/renderer/main.ts`
  Binds first-run buttons, cloud sync settings, and render state.

- `src/renderer/styles.css`
  Styles for the first-run modal and cloud sync settings block.

- `server/leaderboard-worker/src/index.ts`
  Adds cloud tree API routes and D1 upsert logic.

- `server/leaderboard-worker/schema.sql`
  Adds cloud tree tables and indexes.

## Running On Mac

```bash
git clone https://github.com/Olorinm/vibe-tree.git
cd vibe-tree
git fetch origin codex/multi-device-tree-sync
git checkout codex/multi-device-tree-sync
npm install
npm run typecheck
npm run build
npm run start
```

To test against a non-default Worker:

```bash
VIBE_TREE_LEADERBOARD_API_URL=https://your-worker.workers.dev npm run start
```

## Local Data Paths

Development Electron builds usually use the app name `Electron` for `app.getPath("userData")`.

On macOS development builds, check:

```text
~/Library/Application Support/Electron
```

Packaged macOS builds should use:

```text
~/Library/Application Support/Vibe Tree
```

Useful files:

- `device-settings.json`
- `usage-events.jsonl`
- `achievements.json`
- `leaderboard-auth.json`
- `cloud-sync.json`

If the first-run modal appears unexpectedly, inspect `device-settings.json` and confirm `treeStartMode` is set to either `new` or `cloud`.

## Worker Deployment Checklist

The desktop side is wired, but real cross-device sync depends on the Worker and D1 database being migrated and deployed.

```bash
cd server/leaderboard-worker
npm install
npx wrangler d1 execute vibe-tree-leaderboard --file=./schema.sql
npm run deploy
```

Confirm the deployed Worker supports:

```bash
curl https://your-worker.workers.dev/health
```

Then run the desktop app with:

```bash
VIBE_TREE_LEADERBOARD_API_URL=https://your-worker.workers.dev npm run start
```

## Known Issues And Next Work

- The current branch is not a finished release. It is a checkpoint for continuing on Mac.
- The first-run modal previously appeared for an existing Windows user while old dev processes were still serving stale renderer assets. If UI changes do not appear, stop all old Vite/Electron processes and restart from a clean build.
- `Continue existing tree` requires GitHub auth and a Worker with the new `/api/tree` routes deployed. Without that, the UI should show an error rather than silently doing nothing.
- `cloudStatus.hasRemoteTree` is still primitive and mostly based on local sync state. A nicer onboarding flow should query remote state before deciding whether `Continue existing tree` is valid.
- Remote sync currently merges entries by event id and achievements by achievement id. It does not yet provide conflict UI, per-device audit UI, or a reset/relink flow.
- Cloud tree sync reuses the leaderboard auth/profile. This is convenient but product copy should keep leaderboard publishing separate from private tree sync.
- The Worker README still describes leaderboard as the main feature. It should be updated if this branch becomes the main sync architecture.
- The first-run copy should be revisited once the final cloud sync behavior is decided.

## Verification Done On Windows

Commands that passed before handoff:

```powershell
npm run typecheck
npm run build
npm run smoke:electron
```

The Windows machine also had stale dev processes from an older run:

- Vite dev server
- TypeScript watch
- Electron dev instance

If a UI appears unchanged after rebuild, stop all project-local `node`, `electron`, and `esbuild` processes before restarting.

## Suggested Mac Next Steps

1. Pull this branch and run `npm run typecheck && npm run build` on macOS.
2. Deploy or locally run the Worker with the new D1 schema.
3. Test GitHub login on macOS and confirm `leaderboard-auth.json` is written.
4. On Windows, click sync and verify `/api/tree/events` receives ledger entries.
5. On Mac, use `Continue existing tree` and verify entries are pulled into local `usage-events.jsonl`.
6. Confirm achievements merge without replaying unlock toast storms.
7. Decide whether `Continue existing tree` should import local Mac historical logs or only count new events after linking. The safer default is new events only.
