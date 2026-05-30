import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const workerDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const persistDir = mkdtempSync(join(tmpdir(), "vibe-tree-worker-api-"));
const token = "verify-worker-token";
const tokenHash = createHash("sha256").update(token).digest("hex");
const friendToken = "verify-friend-token";
const friendTokenHash = createHash("sha256").update(friendToken).digest("hex");
const now = "2026-05-27T00:00:00.000Z";
const expiresAt = "2099-01-01T00:00:00.000Z";
const port = 17_000 + Math.floor(Math.random() * 1_000);
const baseUrl = `http://127.0.0.1:${port}`;
const utcToday = dateKey(new Date());
const eastOfUtcToday = addDays(utcToday, 1);
let devProcess;

try {
  const seedSql = `
INSERT OR REPLACE INTO users (user_id, username, avatar_url, profile_url, created_at, updated_at)
VALUES ('user-verify', 'verify-user', NULL, NULL, '${now}', '${now}');

INSERT OR REPLACE INTO users (user_id, username, avatar_url, profile_url, created_at, updated_at)
VALUES ('user-friend', 'friend-user', NULL, NULL, '${now}', '${now}');

INSERT OR REPLACE INTO sessions (token_hash, user_id, created_at, expires_at)
VALUES ('${tokenHash}', 'user-verify', '${now}', '${expiresAt}');

INSERT OR REPLACE INTO sessions (token_hash, user_id, created_at, expires_at)
VALUES ('${friendTokenHash}', 'user-friend', '${now}', '${expiresAt}');
`;

  devProcess = spawnWrangler([
    "dev",
    "--ip",
    "127.0.0.1",
    "--port",
    String(port),
    "--persist-to",
    persistDir,
    "--var",
    "APP_ORIGIN:*",
    "--var",
    "GITHUB_CLIENT_ID:test-client",
    "--var",
    "GITHUB_CLIENT_SECRET:test-secret",
    "--var",
    "SESSION_SECRET:test-session-secret",
    "--log-level",
    "error",
    "--show-interactive-dev-session=false",
  ]);

  await waitForWorker();
  await prepareD1Database(seedSql);

  let cloudTree = await requestJson("/api/tree");
  assert(cloudTree.summary?.hasRemoteTree === false, "empty cloud tree summary should not report an existing tree");

  await requestJson("/api/tree/events", {
    method: "POST",
    body: {
      deviceId: "zero-token-device",
      device: { alias: "Zero Token Mac", platform: "mac" },
      appVersion: "0.5.5-test",
      entries: [],
      modelStats: [],
    },
  });

  cloudTree = await requestJson("/api/tree");
  assert(cloudTree.summary?.hasRemoteTree === true, "device-only cloud tree should count as an existing tree");
  assert(cloudTree.summary?.entryCount === 0, "device-only cloud tree should still have zero events");
  assert(cloudTree.summary?.deviceCount === 1, "device-only cloud tree should report its device snapshot");

  await requestJson("/api/tree/events", {
    method: "POST",
    body: {
      deviceId: "mac-device",
      device: { alias: "Mac", platform: "mac" },
      appVersion: "0.5.5-test",
      modelStats: [
        {
          date: utcToday,
          source: "codex-session",
          model: "private-model",
          tokens: 1234,
          inputTokens: 1000,
          outputTokens: 200,
          cacheReadTokens: 34,
          cacheWriteTokens: 0,
          prompt: "private prompt",
          localPath: "/private/workspace/path",
        },
      ],
      entries: [
        {
          id: "mac-event-1",
          createdAt: "2026-05-27T01:00:00.000Z",
          source: "codex-session",
          tokens: 1234,
          inputTokens: 1000,
          outputTokens: 200,
          cacheReadTokens: 34,
          cacheWriteTokens: 0,
          deviceId: "mac-device",
          note: "PRIVATE NOTE",
          agent: "codex-desktop",
          provider: "private-provider",
          model: "private-model",
          prompt: "private prompt",
          reply: "private reply",
          localPath: "/private/workspace/path",
        },
      ],
    },
  });

  await requestJson("/api/tree/achievements", {
    method: "POST",
    body: {
      appVersion: "0.5.5-test",
      achievements: [
        {
          id: "sprout",
          unlockedAt: "2026-05-27T01:01:00.000Z",
          trigger: { prompt: "private trigger" },
        },
      ],
    },
  });

  await requestJson("/api/tree/events", {
    method: "POST",
    body: {
      deviceId: "other-device",
      appVersion: "0.5.5-test",
      entries: [
        {
          id: "mac-event-1-different-path-id",
          createdAt: "2026-05-27T01:00:00.000Z",
          source: "codex-session",
          tokens: 1234,
          inputTokens: 1000,
          outputTokens: 200,
          cacheReadTokens: 34,
          cacheWriteTokens: 0,
          deviceId: "other-device",
        },
      ],
    },
  });

  cloudTree = await requestJson("/api/tree");
  assert(cloudTree.summary?.hasRemoteTree === true, "cloud tree summary should report an existing tree");
  assert(cloudTree.summary?.entryCount === 1, "cloud tree should contain one event");
  assert(cloudTree.summary?.achievementCount === 1, "cloud tree should contain one achievement");
  assert(cloudTree.summary?.deviceCount === 3, "cloud tree should include all device snapshots");
  const [event] = cloudTree.entries ?? [];
  const [achievement] = cloudTree.achievements ?? [];
  const [device] = cloudTree.devices ?? [];
  const [modelStat] = cloudTree.modelStats ?? [];
  assert(event?.id === "mac-event-1", "cloud tree should return the uploaded event");
  assert(event.source === "codex-session", "worker should preserve safe source categories");
  assert(event.deviceId === "mac-device", "worker should preserve device id");
  assert(event.tokens === 1234, "worker should preserve token count");
  assertNoForbiddenKeys(event, "GET /api/tree event");
  assert(achievement?.id === "sprout", "cloud tree should return the uploaded achievement");
  assertNoForbiddenKeys(achievement, "GET /api/tree achievement");
  assert(device?.deviceId === "mac-device" && device.platform === "mac", "cloud tree should return device metadata");
  assert(modelStat?.model === "private-model" && modelStat.tokens === 1234, "cloud tree should return aggregate model stats");
  assert(!("prompt" in modelStat) && !("localPath" in modelStat), "cloud model stats should not leak raw session data");
  const fullTreeCursor = cloudTree.cursor;
  assert(typeof fullTreeCursor === "string" && Number.isFinite(Date.parse(fullTreeCursor)), "full cloud tree should return a sync cursor");

  await delay(5);
  await requestJson("/api/tree/events", {
    method: "POST",
    body: {
      deviceId: "mac-device",
      appVersion: "0.5.5-test",
      modelStats: [
        {
          date: utcToday,
          source: "codex-session",
          model: "private-model",
          tokens: 1334,
          inputTokens: 1100,
          outputTokens: 200,
          cacheReadTokens: 34,
          cacheWriteTokens: 0,
        },
      ],
      entries: [
        {
          id: "mac-event-2",
          createdAt: "2026-05-27T02:00:00.000Z",
          source: "openclaw-session",
          tokens: 100,
          inputTokens: 80,
          outputTokens: 20,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          deviceId: "mac-device",
        },
      ],
    },
  });
  await requestJson("/api/tree/achievements", {
    method: "POST",
    body: {
      appVersion: "0.5.5-test",
      achievements: [
        {
          id: "branch",
          unlockedAt: "2026-05-27T02:01:00.000Z",
        },
      ],
    },
  });
  const deltaTree = await requestJson(`/api/tree/delta?since=${encodeURIComponent(fullTreeCursor)}`);
  assert(deltaTree.delta === true, "delta cloud tree should mark the payload as a delta");
  assert(typeof deltaTree.cursor === "string" && deltaTree.cursor > fullTreeCursor, "delta cloud tree should advance the cursor");
  assert(deltaTree.entries?.length === 1 && deltaTree.entries[0].id === "mac-event-2", "delta cloud tree should only return events changed after the cursor");
  assert(deltaTree.achievements?.length === 1 && deltaTree.achievements[0].id === "branch", "delta cloud tree should only return achievements changed after the cursor");
  assert(deltaTree.devicesFull === true && deltaTree.modelStatsFull === true, "delta cloud tree should include full device and model aggregate snapshots");
  assert(deltaTree.devices?.find((item) => item.deviceId === "mac-device")?.tokens === 1334, "delta cloud tree should use cached per-device totals");
  assert(deltaTree.modelStats?.find((item) => item.model === "private-model")?.tokens === 1334, "delta cloud tree should include the latest aggregate model totals");
  await assertRejects(
    () => requestJson("/api/tree/delta?since=not-a-date"),
    "delta cloud tree should reject invalid cursors",
  );

  await requestJson("/api/usage/daily", {
    method: "POST",
    body: {
      appVersion: "0.5.5-test",
      usageStartDate: utcToday,
      days: [
        { date: utcToday, tokens: 1234 },
        { date: eastOfUtcToday, tokens: 4321 },
      ],
      usagePreferencesPublic: true,
      usagePreferences: [
        {
          range: "24h",
          favoriteAgent: { label: "Codex", percent: 100 },
          favoriteModel: "private-model",
          favoritePeriod: { id: "morning", startHour: 6, endHour: 12 },
          peakTokensPerMinute: 20,
        },
      ],
    },
  });
  let dayLeaderboard = await requestJson("/api/leaderboard?range=today");
  assert(
    dayLeaderboard.entries?.[0]?.tokens === 4321,
    "legacy clients without hourly buckets should still have a recent daily fallback for the 24h leaderboard",
  );

  const currentHour = hourKey(new Date());
  const previousHour = hourKey(addHours(new Date(), -1));
  const oldHour = hourKey(addHours(new Date(), -25));
  await requestJson("/api/usage/daily", {
    method: "POST",
    body: {
      appVersion: "0.5.5-test",
      forceSync: true,
      usageStartDate: utcToday,
      days: [
        { date: utcToday, tokens: 1234 },
        { date: eastOfUtcToday, tokens: 5000 },
      ],
      hours: [
        { hourStartUtc: previousHour, tokens: 1111 },
        { hourStartUtc: currentHour, tokens: 2222 },
        { hourStartUtc: oldHour, tokens: 999999 },
      ],
    },
  });
  dayLeaderboard = await requestJson("/api/leaderboard?range=24h");
  assert(dayLeaderboard.range === "24h", "leaderboard should expose the rolling 24h range");
  assert(dayLeaderboard.entries?.[0]?.tokens === 3333, "rolling 24h leaderboard should use hourly buckets");
  dayLeaderboard = await requestJson("/api/leaderboard?range=today");
  assert(dayLeaderboard.entries?.[0]?.tokens === 3333, "legacy today range should alias to rolling 24h");
  const leaderboardCollection = await requestJson("/api/leaderboards");
  assert(leaderboardCollection.ranges?.["24h"]?.entries?.[0]?.tokens === 3333, "leaderboard collection should expose 24h");
  assert(leaderboardCollection.ranges?.today?.entries?.[0]?.tokens === 3333, "leaderboard collection should keep a legacy today alias");

  let friendList = await requestJson("/api/social/friends");
  assert(Array.isArray(friendList.friends) && friendList.friends.length === 0, "fresh user should start without friends");
  const friendRequest = await requestJson("/api/social/friends", {
    method: "POST",
    body: { username: "friend-user" },
  });
  assert(friendRequest.friend?.status === "pending", "friend request should start pending");
  assert(friendRequest.friend?.direction === "outgoing", "requester should see outgoing friend request");
  const incomingRequest = await requestJson("/api/social/friends", { token: friendToken });
  assert(incomingRequest.friends?.[0]?.direction === "incoming", "target should see incoming friend request");
  const acceptedFriend = await requestJson("/api/social/friends/user-verify/accept", {
    method: "POST",
    token: friendToken,
  });
  assert(acceptedFriend.friend?.status === "accepted", "incoming friend request should be accepted");
  friendList = await requestJson("/api/social/friends");
  assert(friendList.friends?.[0]?.status === "accepted", "requester should see accepted friend");
  const removedFriendList = await requestJson("/api/social/friends/user-friend", { method: "DELETE" });
  assert(removedFriendList.friends?.length === 0, "removing a friend should clear the relationship");

  const groupCreate = await requestJson("/api/social/groups", {
    method: "POST",
    body: {
      name: "Vibe Guild",
      description: "A playful coding guild",
      iconEmoji: "🌱",
    },
  });
  const groupId = groupCreate.group?.groupId;
  assert(groupId && groupCreate.group?.role === "leader", "social group creator should become leader");
  assert(groupCreate.group?.memberCount === 1, "new social group should start with one member");

  const invite = await requestJson(`/api/social/groups/${encodeURIComponent(groupId)}/invites`, {
    method: "POST",
    body: { maxUses: 2 },
  });
  assert(typeof invite.invite?.code === "string", "group invite should return a one-time visible invite code");

  const joined = await requestJson(`/api/social/invites/${encodeURIComponent(invite.invite.code)}/accept`, {
    method: "POST",
    token: friendToken,
  });
  assert(joined.group?.memberCount === 2, "group invite should add the second member");
  assert(joined.group?.members?.some((member) => member.userId === "user-friend"), "joined group should list the new member");

  const friendGroups = await requestJson("/api/social/groups", { token: friendToken });
  assert(friendGroups.groups?.[0]?.groupId === groupId, "joined member should see the group in their group list");

  await requestJson("/api/usage/daily", {
    method: "POST",
    token: friendToken,
    body: {
      appVersion: "0.5.5-test",
      forceSync: true,
      usageStartDate: utcToday,
      days: [{ date: eastOfUtcToday, tokens: 777 }],
      hours: [{ hourStartUtc: currentHour, tokens: 777 }],
    },
  });
  const groupLeaderboard = await requestJson(`/api/social/groups/${encodeURIComponent(groupId)}/leaderboard?range=24h`);
  assert(groupLeaderboard.entries?.length === 2, "group leaderboard should include both sharing members");
  assert(groupLeaderboard.entries?.[0]?.tokens === 3333, "group leaderboard should rank the highest member first");
  assert(groupLeaderboard.entries?.[1]?.tokens === 777, "group leaderboard should include the invited member contribution");

  // (d) share_usage=false hides a member from the group board; restoring it shows them again.
  await requestJson(`/api/social/groups/${encodeURIComponent(groupId)}/membership`, {
    method: "POST",
    token: friendToken,
    body: { shareUsage: false },
  });
  const groupBoardNoShare = await requestJson(`/api/social/groups/${encodeURIComponent(groupId)}/leaderboard?range=24h`);
  assert(
    !groupBoardNoShare.entries?.some((entry) => entry.userId === "user-friend"),
    "share_usage=false should hide the member from the group board",
  );
  await requestJson(`/api/social/groups/${encodeURIComponent(groupId)}/membership`, {
    method: "POST",
    token: friendToken,
    body: { shareUsage: true },
  });
  const groupBoardShare = await requestJson(`/api/social/groups/${encodeURIComponent(groupId)}/leaderboard?range=24h`);
  assert(
    groupBoardShare.entries?.some((entry) => entry.userId === "user-friend"),
    "restoring share_usage should show the member on the group board again",
  );

  // (a) a non-public member is hidden from the GLOBAL board but stays on the GROUP board.
  await requestJson("/api/usage/daily", {
    method: "POST",
    token: friendToken,
    body: {
      appVersion: "0.5.5-test",
      forceSync: true,
      usagePublic: false,
      usageStartDate: utcToday,
      days: [{ date: eastOfUtcToday, tokens: 777 }],
      hours: [{ hourStartUtc: currentHour, tokens: 777 }],
    },
  });
  const globalAfterPrivate = await requestJson("/api/leaderboard?range=24h", { token: friendToken });
  assert(
    !globalAfterPrivate.entries?.some((entry) => entry.userId === "user-friend"),
    "non-public member should not appear on the global board",
  );
  assert(
    globalAfterPrivate.entries?.some((entry) => entry.userId === "user-verify"),
    "public member should still appear on the global board",
  );
  const groupAfterPrivate = await requestJson(
    `/api/social/groups/${encodeURIComponent(groupId)}/leaderboard?range=24h`,
    { token: friendToken },
  );
  assert(
    groupAfterPrivate.entries?.some((entry) => entry.userId === "user-friend"),
    "non-public member should still appear on the group board",
  );

  await assertRejects(
    () =>
      requestJson("/api/usage/daily", {
        method: "POST",
        body: {
          appVersion: "0.5.5-test",
          usageStartDate: utcToday,
          days: [{ date: eastOfUtcToday, tokens: 5678 }],
          hours: [{ hourStartUtc: currentHour, tokens: 5678 }],
        },
      }),
    "non-forced leaderboard sync should still honor cooldown",
  );

  await requestJson("/api/leaderboard", { method: "DELETE" });
  cloudTree = await requestJson("/api/tree");
  assert(cloudTree.summary?.entryCount === 2, "leaving leaderboard must not delete cloud tree events");
  assert(cloudTree.summary?.achievementCount === 2, "leaving leaderboard must not delete cloud tree achievements");

  // (b) leaving the global board keeps group data: user-verify (in a group) drops off the
  // global board but stays on the group board with the same contribution.
  const globalAfterLeave = await requestJson("/api/leaderboard?range=24h");
  assert(
    !globalAfterLeave.entries?.some((entry) => entry.userId === "user-verify"),
    "leaving the global board should hide the user from it",
  );
  const groupAfterLeave = await requestJson(`/api/social/groups/${encodeURIComponent(groupId)}/leaderboard?range=24h`);
  assert(
    groupAfterLeave.entries?.some((entry) => entry.userId === "user-verify"),
    "leaving the global board must keep the user's group contribution",
  );

  // (c) leaving a group removes the member; the owner cannot leave their own group.
  await assertRejects(
    () => requestJson(`/api/social/groups/${encodeURIComponent(groupId)}/members/me`, { method: "DELETE" }),
    "group owner should not be able to leave their own group",
  );
  await requestJson(`/api/social/groups/${encodeURIComponent(groupId)}/members/me`, {
    method: "DELETE",
    token: friendToken,
  });
  const friendGroupsAfterLeave = await requestJson("/api/social/groups", { token: friendToken });
  assert(
    !friendGroupsAfterLeave.groups?.some((group) => group.groupId === groupId),
    "leaving a group should remove it from the member's group list",
  );
  const groupAfterMemberLeave = await requestJson(`/api/social/groups/${encodeURIComponent(groupId)}/leaderboard?range=24h`);
  assert(
    !groupAfterMemberLeave.entries?.some((entry) => entry.userId === "user-friend"),
    "leaving a group should remove the member from the group board",
  );

  console.log("Worker API verified: device-only cloud trees, tree sync privacy, delta cloud tree sync, achievement privacy, 24h leaderboard buckets, social friends, social groups/invites/group leaderboard, group/global decoupling (private members, leave-keeps-group-data, leave-group, share toggle), legacy fallback, and leaderboard leave safety passed.");
} finally {
  if (devProcess) await terminate(devProcess);
  rmSync(persistDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
}

function wranglerCommand() {
  if (process.platform === "win32") {
    const npxCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js");
    if (existsSync(npxCli)) return { command: process.execPath, args: [npxCli, "--yes", "wrangler@3.114.0"] };
  }
  const candidates = ["/opt/homebrew/bin/npx", "/usr/local/bin/npx", "/usr/bin/npx", "npx"];
  const command = candidates.find((candidate) => candidate === "npx" || existsSync(candidate));
  return { command: command ?? candidates[0], args: ["--yes", "wrangler@3.114.0"] };
}

function spawnWrangler(args) {
  const wrangler = wranglerCommand();
  const commandArgs = [...wrangler.args, ...args];
  const child = spawn(wrangler.command, commandArgs, {
    cwd: workerDir,
    env: {
      ...process.env,
      PATH: ["/opt/homebrew/bin", "/usr/local/bin", process.env.PATH].filter(Boolean).join(delimiter),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: process.platform !== "win32",
  });
  child.output = "";
  const collect = (chunk) => {
    child.output = `${child.output}${chunk.toString("utf8")}`.slice(-20_000);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  return child;
}

async function prepareD1Database(seedSql) {
  await ensureLocalD1DatabaseCreated();
  const databasePath = findLocalD1DatabasePath();
  await runSqliteScript(databasePath, readFileSync(join(workerDir, "schema.sql"), "utf8"));
  await runSqliteScript(databasePath, seedSql);
}

async function ensureLocalD1DatabaseCreated() {
  try {
    await fetch(`${baseUrl}/api/leaderboard?range=24h`);
  } catch {
    // The first D1-backed request may fail before schema is loaded; it still creates the local SQLite file.
  }
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    try {
      findLocalD1DatabasePath();
      return;
    } catch {
      await delay(100);
    }
  }
  findLocalD1DatabasePath();
}

function findLocalD1DatabasePath() {
  const databaseDir = join(persistDir, "v3", "d1", "miniflare-D1DatabaseObject");
  const databaseFile = readdirSync(databaseDir).find((file) => file.endsWith(".sqlite"));
  assert(databaseFile, `Could not find local D1 sqlite database in ${databaseDir}`);
  return join(databaseDir, databaseFile);
}

function runSqliteScript(databasePath, sql) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("sqlite3", [databasePath], {
      env: {
      ...process.env,
      PATH: ["/opt/homebrew/bin", "/usr/local/bin", process.env.PATH].filter(Boolean).join(delimiter),
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = "";
    const collect = (chunk) => {
      output = `${output}${chunk.toString("utf8")}`.slice(-20_000);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`sqlite3 failed (${code ?? signal ?? "unknown"})\n${output.trim()}`));
    });
    child.stdin.end(sql);
  });
}

async function waitForWorker() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 20_000) {
    if (devProcess.exitCode !== null) {
      throw new Error(`wrangler dev exited early (${devProcess.exitCode})\n${devProcess.output.trim()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // Retry until wrangler dev finishes booting.
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for wrangler dev\n${devProcess.output.trim()}`);
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${options.token ?? token}`,
      "Content-Type": "application/json",
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${path} failed (${response.status}) ${text}`);
  }
  return body;
}

function terminate(child) {
  if (child.killed) return Promise.resolve();
  if (process.platform === "win32" && child.pid) {
    return new Promise((resolveTerminate) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
      killer.on("error", () => resolveTerminate());
      killer.on("exit", () => resolveTerminate());
    });
  }
  if (child.pid) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
  return delay(500);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return dateKey(date);
}

function addHours(value, hours) {
  const date = new Date(value);
  date.setUTCHours(date.getUTCHours() + hours);
  return date;
}

function hourKey(value) {
  const date = new Date(value);
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

async function assertRejects(action, message) {
  try {
    await action();
  } catch {
    return;
  }
  throw new Error(message);
}

function assertNoForbiddenKeys(value, label) {
  for (const key of [
    "note",
    "agent",
    "provider",
    "model",
    "prompt",
    "reply",
    "content",
    "path",
    "localPath",
    "file",
    "session",
    "trigger",
    "triggerJson",
  ]) {
    assert(!(key in value), `${label} leaked forbidden key: ${key}`);
  }
}
