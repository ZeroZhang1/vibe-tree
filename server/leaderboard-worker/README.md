# Vibe Tree Cloud Worker

Cloudflare Worker + D1 backend for two opt-in cloud features:

- Private shared tree sync, so one GitHub account can keep growing the same tree across devices.
- Optional global leaderboard publishing.

The desktop app never uploads prompts, replies, code files, local paths, session text, raw notes, or per-event model/provider labels. Shared tree sync sends token ledger events with safe source categories, device id, achievement unlock state, coarse device summaries, and daily aggregate model totals grouped by device/source/model. Leaderboard sync sends daily token totals and the local first-use date; if a user explicitly enables public usage preferences, it also sends range-scoped aggregate preferences only: top agent percentage, top model, preferred coding period, and peak token/min.

The first release is community-oriented, not strict cheat-proof scoring. The backend keeps only broad safety rails:

- Daily payloads above `1,000,000,000,000,000` tokens are rejected as obviously invalid dirty data.
- Each GitHub user can sync at most once every 30 seconds.
- Leaderboard sync accepts only the latest 30 daily rows, while the database retains older rows that were synced in previous windows for the all-time leaderboard.
- Cloudflare Worker rate limit bindings throttle leaderboard reads, OAuth entry points, and write APIs per IP and route.
- Suspicious events are written as structured Workers Logs. High-signal non-rate-limit events are also stored in D1 `security_events` with hashed IP values; rate-limit and normal sync-cooldown hits stay out of D1 to avoid turning button mashing into write load.

The IP limit is a coarse abuse brake, not identity. Public networks, VPNs, mobile carriers, and corporate NATs may share an IP, so the Worker also keeps the per-GitHub-user sync cooldown.

Current rate limits are intentionally generous while usage is small:

- Public leaderboard reads: `600/min/IP`.
- Write APIs, including usage sync and account deletion: `300/min/IP`.
- Auth routes: `20/min/IP`.

The Worker rate-limit binding only supports 10-second or 60-second windows, so hour-level limits are deferred until real traffic justifies adding a Durable Object counter.

## Routes

### Auth

- `GET /auth/github/start` starts the GitHub OAuth flow.
- `GET /auth/github/callback` completes OAuth and returns a short-lived one-time code to the desktop app's localhost callback.
- `POST /auth/session` exchanges the one-time code plus the app-held verifier for a session token.
- `GET /api/me` returns the signed-in GitHub profile.
- `DELETE /api/me` removes the user, sessions, leaderboard token rows, public preference rows, shared tree events, achievements, device summaries, aggregate model stats, sync state, auth codes, and user-linked security log rows.

### Shared Tree Sync

- `GET /api/tree` returns cloud tree events, achievements, device summaries, aggregate model stats, and a summary with `hasRemoteTree`.
- `POST /api/tree/events` upserts token events, refreshes the current device snapshot, and replaces that device's aggregate model stats when provided.
- `POST /api/tree/achievements` upserts achievement unlock state.

Remote tree existence is true when the account has any tree events, achievements, device snapshots, or aggregate model stats. This lets a second device join a tree that was just enabled on the first device before any token was produced.

### Leaderboard

- `POST /api/usage/daily` upserts daily token aggregates and, when opted in, range-scoped aggregate usage preferences.
- `GET /api/leaderboard?range=today|7d|30d|all` returns the top 100 users plus public preference details when the user opted in.
- `GET /api/leaderboards` returns all four leaderboard ranges in one response.

## Setup

1. Create a GitHub OAuth app.

   Homepage URL:

   ```text
   https://your-worker-subdomain.workers.dev
   ```

   Authorization callback URL:

   ```text
   https://your-worker-subdomain.workers.dev/auth/github/callback
   ```

2. Create a D1 database and replace `database_id` in `wrangler.jsonc`.

   ```bash
   npx wrangler d1 create vibe-tree-leaderboard
   ```

3. Add secrets.

   ```bash
   npx wrangler secret put GITHUB_CLIENT_ID
   npx wrangler secret put GITHUB_CLIENT_SECRET
   npx wrangler secret put SESSION_SECRET
   ```

   `SESSION_SECRET` should be a long random string.

4. Run migrations and deploy.

   ```bash
   npm install
   npm run db:migrate
   npm run db:migrate:privacy
   npm run db:migrate:sources
   npm run db:migrate:dedupe
   npm run db:migrate:devices
   npm run deploy
   ```

   For a fresh database, `db:migrate` creates all current tables. The extra migration scripts are safe to run for upgraded deployments that may already contain older cloud-tree tables or old source rows.

5. Start the desktop app with the Worker URL, or set this as the production default in the Electron app.

   ```bash
   VIBE_TREE_LEADERBOARD_API_URL=https://your-worker-subdomain.workers.dev npm start
   ```

Packaged builds can keep a production Worker URL in the Electron app and still use `VIBE_TREE_LEADERBOARD_API_URL` as a local override.

## Monitoring

Workers Logs are enabled in `wrangler.jsonc`. Filter for `leaderboard_security` to inspect rate limits, auth failures, sync cooldowns, invalid payloads, and server errors. The D1 `security_events` table keeps the non-rate-limit events for quick review.

Useful checks:

```bash
npx wrangler tail vibe-tree-leaderboard --format=pretty
npx wrangler d1 execute vibe-tree-leaderboard --remote --command "SELECT created_at, type, path, status, country FROM security_events ORDER BY created_at DESC LIMIT 20"
npm run verify:api
```

For push alerts, connect Workers Logs to Cloudflare Notifications, Logpush, or a Tail Worker that forwards high-severity events to your alert destination.
