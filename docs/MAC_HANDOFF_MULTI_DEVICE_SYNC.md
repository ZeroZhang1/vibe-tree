# Mac Handoff: Multi-device Tree Sync

Date: 2026-05-27
Branch: `codex/multi-device-tree-sync`

This branch is a handoff snapshot for continuing real multi-device Vibe Tree sync on a Mac.

Latest Mac checkpoint: 2026-05-27, after the first privacy and first-run hardening pass.

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

This branch adds the first implementation pass for cloud tree sync, plus a Mac-side hardening pass:

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
  - `tree_devices`
  - `tree_model_stats`
- First-run usage watchers now wait for the user to choose `Grow a new tree` or `Continue existing tree`, so old local history is not imported before consent.
- `Grow a new tree` resets `installedAt` to the choice time and only counts new local token events.
- `Continue existing tree` now requires a non-empty remote tree; otherwise it keeps first-run mode active and shows an error.
- Cloud tree sync strips local agent/note/trigger details and does not upload prompt, reply, session text, file content, or local paths.
- Pulled cloud events preserve safe source categories such as `codex-session`, `openclaw-session`, and `claude-session`, so remote growth is merged into its real source rather than shown as a separate Cloud Tree source.
- Per-event model/provider remains local by default. Aggregate model sync uploads only daily totals grouped by device/source/model, not individual sessions.
- Leaving the leaderboard now deletes only remote leaderboard daily totals/preferences and keeps the shared cloud tree archive intact.
- A local contract verification script simulates Windows and Mac sharing one fake cloud tree.

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

- `server/leaderboard-worker/migrations/20260527_trim_cloud_tree_privacy.sql`
  Rebuilds existing D1 cloud tree tables without historical `agent`, `provider`, `model`, `note`, or achievement `trigger_json` columns.

- `server/leaderboard-worker/migrations/20260528_cloud_tree_device_model_stats.sql`
  Adds cloud tree device summaries and aggregate model-stat tables.

- `scripts/verify-cloud-sync.mjs`
  Verifies two-device merge, de-dupe, empty remote-tree guard, leaderboard leave safety, and the cloud payload privacy whitelist against a fake cloud API.

- `server/leaderboard-worker/scripts/verify-worker-api.mjs`
  Starts a local Wrangler Worker with local D1 and verifies `/api/tree`, `/api/tree/events`, `/api/tree/achievements`, and leaderboard leave behavior over HTTP.

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
npx wrangler d1 execute vibe-tree-leaderboard --file=./migrations/20260527_trim_cloud_tree_privacy.sql
npx wrangler d1 execute vibe-tree-leaderboard --file=./migrations/20260528_cloud_tree_device_model_stats.sql
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
- `cloudStatus.hasRemoteTree` is still primitive and mostly based on local sync state. `Continue existing tree` validates the remote tree during join, but a nicer onboarding flow could query remote state before the user clicks.
- Remote sync currently merges entries by event id and achievements by achievement id. It now stores per-device contribution summaries, but it still does not provide a full conflict UI or reset/relink flow.
- Cloud tree sync reuses the leaderboard auth/profile. This is convenient but product copy should keep leaderboard publishing separate from private tree sync.
- The Worker README still describes leaderboard as the main feature. It should be updated if this branch becomes the main sync architecture.
- The first-run copy should be revisited once the final cloud sync behavior is decided.

## Verification Done On Mac

Commands that passed after the Mac hardening pass:

```bash
npm run typecheck
npm run build
npm run verify:cloud-sync
npm run verify:worker-api
npm run smoke:electron
cd server/leaderboard-worker
npx wrangler@3.114.0 deploy --dry-run --outdir /tmp/vibe-tree-worker-dry-run
```

Additional runtime checks:

- Fresh isolated Electron user data showed the first-run modal.
- No `usage-events.jsonl` was created before the first-run choice.
- Clicking `Grow a new tree` wrote `treeStartMode: "new"` and reset `usage-meta.json` `installedAt` to the click time.
- The source/history UI no longer shows `Cloud Tree` for an account with no cloud sync and no cloud entries.
- The D1 privacy migration was syntax-tested with local `sqlite3`; old private columns were dropped while token/device/achievement data remained.

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

1. Deploy the Worker and run both `schema.sql` and `migrations/20260527_trim_cloud_tree_privacy.sql` against D1.
2. Test GitHub login on macOS and confirm `leaderboard-auth.json` is written.
3. On Windows, choose/enable cloud sync and verify `/api/tree/events` receives only token counts, device id, and timestamps.
4. On Mac, use `Continue existing tree` and verify Windows entries are pulled into local `usage-events.jsonl` as `cloud-sync`.
5. Generate a new Mac token event, sync, then verify Windows pulls it back without duplicate entries.
6. Confirm achievements merge without replaying unlock toast storms.
7. Decide whether to add remote-tree discovery before the first-run button click; current behavior validates only after click/login.
