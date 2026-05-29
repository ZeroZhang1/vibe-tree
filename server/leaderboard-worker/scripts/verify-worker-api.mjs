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

INSERT OR REPLACE INTO sessions (token_hash, user_id, created_at, expires_at)
VALUES ('${tokenHash}', 'user-verify', '${now}', '${expiresAt}');
`;

  await prepareD1Database(seedSql);

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
  assert(cloudTree.summary?.entryCount === 1, "leaving leaderboard must not delete cloud tree events");
  assert(cloudTree.summary?.achievementCount === 1, "leaving leaderboard must not delete cloud tree achievements");

  console.log("Worker API verified: device-only cloud trees, tree sync privacy, achievement privacy, 24h leaderboard buckets, legacy fallback, and leaderboard leave safety passed.");
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

function runWrangler(args) {
  const child = spawnWrangler(args);
  return new Promise((resolvePromise, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`wrangler ${args.join(" ")} failed (${code ?? signal ?? "unknown"})\n${child.output.trim()}`));
    });
  });
}

async function prepareD1Database(seedSql) {
  await runWrangler([
    "d1",
    "execute",
    "vibe-tree-leaderboard",
    "--yes",
    "--local",
    "--persist-to",
    persistDir,
    "--command",
    "SELECT(1)",
  ]);

  const databasePath = findLocalD1DatabasePath();
  await runSqliteScript(databasePath, readFileSync(join(workerDir, "schema.sql"), "utf8"));
  await runSqliteScript(databasePath, seedSql);
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
      Authorization: `Bearer ${token}`,
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
