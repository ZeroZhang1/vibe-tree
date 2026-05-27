import { existsSync } from "node:fs";

const leaderboardModuleUrl = new URL("../dist/electron/leaderboard.js", import.meta.url);
const tokenAccountingModuleUrl = new URL("../dist/shared/tokenAccounting.js", import.meta.url);

if (!existsSync(leaderboardModuleUrl) || !existsSync(tokenAccountingModuleUrl)) {
  throw new Error("Missing built files. Run npm run build before scripts/verify-cloud-sync.mjs.");
}

const { createLeaderboardService } = await import(leaderboardModuleUrl.href);
const { countedTokensForEntry } = await import(tokenAccountingModuleUrl.href);

const profile = { id: "github-user-1", username: "olorin" };
const forbiddenEventKeys = [
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
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function assertNoForbiddenKeys(value, label) {
  for (const key of forbiddenEventKeys) {
    assert(!(key in value), `${label} leaked forbidden key: ${key}`);
  }
}

function createFakeCloud() {
  const events = new Map();
  const achievements = new Map();
  const requests = [];
  let leaderboardDeleteCount = 0;

  async function requestJson(urlString, options = {}) {
    const url = new URL(urlString);
    const method = options.method ?? (options.body === undefined ? "GET" : "POST");
    const body = clone(options.body);
    requests.push({ path: url.pathname, method, body });

    if (url.pathname === "/api/tree" && method === "GET") {
      const entries = [...events.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
      const unlocked = [...achievements.values()].sort((left, right) => left.unlockedAt.localeCompare(right.unlockedAt));
      return {
        entries,
        achievements: unlocked,
        summary: {
          hasRemoteTree: entries.length > 0 || unlocked.length > 0,
          entryCount: entries.length,
          achievementCount: unlocked.length,
        },
      };
    }

    if (url.pathname === "/api/tree/events" && method === "POST") {
      assert(options.token === "token", "tree event upload requires auth token");
      assert(typeof body?.deviceId === "string" && body.deviceId, "tree event upload requires device id");
      const entries = Array.isArray(body?.entries) ? body.entries : [];
      for (const entry of entries) {
        assertNoForbiddenKeys(entry, `uploaded event ${entry?.id ?? "unknown"}`);
        assert(isSafeCloudSource(entry.source), `uploaded event ${entry?.id ?? "unknown"} used an unsafe source`);
        events.set(entry.id, {
          id: entry.id,
          createdAt: entry.createdAt,
          source: normalizeCloudSource(entry.source, entry.id),
          tokens: Math.max(0, Math.round(Number(entry.tokens))),
          inputTokens: optionalCount(entry.inputTokens),
          outputTokens: optionalCount(entry.outputTokens),
          cacheReadTokens: optionalCount(entry.cacheReadTokens),
          cacheWriteTokens: optionalCount(entry.cacheWriteTokens),
          deviceId: entry.deviceId || body.deviceId,
          eventFingerprint: entry.eventFingerprint,
        });
      }
      return { ok: true, synced: entries.length };
    }

    if (url.pathname === "/api/tree/achievements" && method === "POST") {
      assert(options.token === "token", "achievement upload requires auth token");
      const unlocked = Array.isArray(body?.achievements) ? body.achievements : [];
      for (const achievement of unlocked) {
        assert(!("trigger" in achievement), `uploaded achievement ${achievement?.id ?? "unknown"} leaked trigger`);
        achievements.set(achievement.id, {
          id: achievement.id,
          unlockedAt: achievement.unlockedAt,
        });
      }
      return { ok: true, synced: unlocked.length };
    }

    if (url.pathname === "/api/leaderboard" && method === "DELETE") {
      assert(options.token === "token", "leaderboard leave requires auth token");
      leaderboardDeleteCount += 1;
      return { ok: true };
    }

    throw new Error(`Unexpected fake cloud request: ${method} ${url.pathname}`);
  }

  return {
    events,
    achievements,
    requests,
    requestJson,
    get leaderboardDeleteCount() {
      return leaderboardDeleteCount;
    },
  };
}

function optionalCount(value) {
  if (value === undefined || value === null) return undefined;
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function createDevice(name, deviceId, cloud, { entries = [], achievements = [] } = {}) {
  const files = new Map([
    [
      `${name}:auth`,
      {
        token: "token",
        profile,
        createdAt: "2026-05-27T00:00:00.000Z",
      },
    ],
  ]);
  const ledger = {
    installedAt: "2026-05-27T00:00:00.000Z",
    settings: {
      cloudSyncEnabled: false,
      cloudSyncDeviceId: deviceId,
      leaderboardProfile: profile,
      leaderboardPreferencesPublic: false,
      treeStartMode: undefined,
    },
    entries: clone(entries),
  };
  let achievementState = { unlocked: clone(achievements) };

  const service = createLeaderboardService({
    apiUrl: "https://fake-cloud.local",
    appName: "Vibe Tree",
    syncIntervalMs: 86_400_000,
    authTimeoutMs: 1_000,
    callbackPath: "/leaderboard/auth/callback",
    authPath: () => `${name}:auth`,
    cloudSyncPath: () => `${name}:cloud`,
    deviceId: () => deviceId,
    getLedger: () => ledger,
    getAchievements: () => achievementState,
    updateSettings: (partial) => {
      ledger.settings = { ...ledger.settings, ...partial };
    },
    appendRemoteEntries: (remoteEntries) => {
      const existing = new Map(ledger.entries.map((entry) => [entry.id, entry]));
      const accepted = [];
      for (const entry of remoteEntries) {
        assertNoForbiddenKeys(entry, `remote event ${entry?.id ?? "unknown"}`);
        if (!entry?.id) continue;
        const normalized = {
          ...entry,
          tokens: countedTokensForEntry(entry),
        };
        const current = existing.get(entry.id);
        if (current) {
          if (current.source === "cloud-sync" || current.syncedFromCloud) {
            Object.assign(current, normalized);
          }
          continue;
        }
        existing.set(entry.id, normalized);
        accepted.push(normalized);
      }
      ledger.entries = [...accepted, ...ledger.entries].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
      return accepted.length;
    },
    mergeRemoteAchievements: (unlocked) => {
      const existing = new Set(achievementState.unlocked.map((item) => item.id));
      const accepted = [];
      for (const item of unlocked) {
        assert(!("trigger" in item), `remote achievement ${item?.id ?? "unknown"} leaked trigger`);
        if (!item?.id || existing.has(item.id)) continue;
        existing.add(item.id);
        accepted.push(item);
      }
      achievementState = { unlocked: [...achievementState.unlocked, ...accepted] };
      return accepted.length;
    },
    xpForEntry: countedTokensForEntry,
    dateKey: (date) => date.toISOString().slice(0, 10),
    currentAppVersion: () => "0.5.5-test",
    mainText,
    openExternal: async () => {
      throw new Error("GitHub auth should not open during contract verification");
    },
    readJsonFile: (path) => clone(files.get(path)),
    writeJsonAtomic: (path, value) => {
      files.set(path, clone(value));
    },
    broadcastStatus: () => {},
    requestJson: cloud.requestJson,
  });
  service.readAuth();

  return {
    service,
    ledger,
    files,
    get achievements() {
      return achievementState;
    },
  };
}

function mainText(key) {
  const text = {
    leaderboardServiceNotConfigured: "service not configured",
    leaderboardLoginRequired: "login required",
    leaderboardLoginFailed: "login failed",
    leaderboardSyncFailed: "sync failed",
    leaderboardLoadFailed: "load failed",
    leaderboardLoggedOut: "logged out",
    cloudSyncNoRemoteTree: "no remote tree",
  };
  return text[key] ?? key;
}

function localEntry(id, deviceId, source, createdAt, tokens) {
  return {
    id,
    createdAt,
    source,
    tokens,
    note: "PRIVATE NOTE SHOULD NOT UPLOAD",
    agent: `${source}:agent`,
    provider: "private-provider",
    model: "private-model",
    prompt: "private prompt",
    localPath: "/private/workspace/path",
    inputTokens: Math.floor(tokens * 0.6),
    outputTokens: Math.floor(tokens * 0.3),
    cacheReadTokens: Math.floor(tokens * 0.1),
    cacheWriteTokens: 0,
    deviceId,
  };
}

function normalizeCloudSource(source, eventId) {
  if (isSafeCloudSource(source) && source !== "cloud-sync") return source;
  const inferred = typeof eventId === "string" && eventId.includes(":") ? eventId.slice(0, eventId.indexOf(":")) : undefined;
  return isSafeCloudSource(inferred) ? inferred : "cloud-sync";
}

function isSafeCloudSource(source) {
  return safeCloudSources.has(source);
}

const safeCloudSources = new Set([
  "manual",
  "codex-session",
  "claude-session",
  "openclaw-session",
  "pi-session",
  "opencode-session",
  "gemini-session",
  "hermes-session",
  "cloud-sync",
]);

const emptyCloud = createFakeCloud();
const emptyMac = createDevice("empty-mac", "mac-empty", emptyCloud);
let status = await emptyMac.service.joinCloudTree();
assert(status.error === "no remote tree", "joining an empty account should return a no remote tree error");
assert(emptyMac.ledger.settings.cloudSyncEnabled === false, "joining an empty account should leave cloud sync disabled");

const cloud = createFakeCloud();
const windows = createDevice("windows", "win-device", cloud, {
  entries: [localEntry("win-event-1", "win-device", "codex-session", "2026-05-27T01:00:00.000Z", 1000)],
  achievements: [
    {
      id: "sprout",
      unlockedAt: "2026-05-27T01:01:00.000Z",
      trigger: { prompt: "private trigger data" },
    },
  ],
});
windows.ledger.settings.cloudSyncEnabled = true;
windows.ledger.settings.treeStartMode = "new";

status = await windows.service.syncCloudTree({ force: true });
assert(!status.error, `windows initial sync failed: ${status.error}`);
assert(cloud.events.size === 1, "windows initial sync should upload one event");
assert(cloud.achievements.size === 1, "windows initial sync should upload one achievement");
assert(cloud.events.get("win-event-1").source === "codex-session", "cloud should preserve safe source categories");

const mac = createDevice("mac", "mac-device", cloud);
status = await mac.service.joinCloudTree();
assert(!status.error, `mac join existing failed: ${status.error}`);
assert(mac.ledger.entries.length === 1, "mac should pull the windows event");
assert(mac.ledger.entries[0].source === "codex-session", "mac should preserve pulled event source");
assert(mac.ledger.entries[0].syncedFromCloud === true, "mac should mark pulled events as cloud-synced");
assert(mac.ledger.entries[0].deviceId === "win-device", "mac should preserve remote device id");
assert(mac.achievements.unlocked.some((item) => item.id === "sprout"), "mac should merge remote achievement");

const eventPostCountAfterJoin = cloud.requests.filter((request) => request.path === "/api/tree/events").length;
mac.ledger.entries.unshift(localEntry("win-event-1-different-local-id", "mac-device", "codex-session", "2026-05-27T01:00:00.000Z", 1000));
status = await mac.service.syncCloudTree({ force: true });
assert(!status.error, `mac duplicate-history sync failed: ${status.error}`);
assert(cloud.events.size === 1, "mac should not upload same historical event with a different local id");

mac.ledger.entries.unshift(localEntry("mac-event-1", "mac-device", "claude-session", "2026-05-27T02:00:00.000Z", 2000));
mac.achievements.unlocked.push({
  id: "mac-growth",
  unlockedAt: "2026-05-27T02:01:00.000Z",
  trigger: { reply: "private reply" },
});
status = await mac.service.syncCloudTree({ force: true });
assert(!status.error, `mac force sync failed: ${status.error}`);
assert(cloud.events.size === 2, "mac sync should add exactly one new event");
assert(cloud.achievements.has("mac-growth"), "mac sync should upload new achievement");

const macEventUploads = cloud.requests
  .slice(eventPostCountAfterJoin)
  .filter((request) => request.path === "/api/tree/events")
  .flatMap((request) => request.body.entries);
assert(macEventUploads.some((entry) => entry.id === "mac-event-1"), "mac sync should upload the mac local event");
assert(!macEventUploads.some((entry) => entry.id === "win-event-1"), "mac sync should not re-upload pulled cloud events");

status = await windows.service.syncCloudTree();
assert(!status.error, `windows follow-up sync failed: ${status.error}`);
assert(
  windows.ledger.entries.some((entry) => entry.id === "mac-event-1" && entry.source === "claude-session" && entry.syncedFromCloud),
  "windows should pull mac event with its safe source category",
);
assert(windows.achievements.unlocked.some((item) => item.id === "mac-growth"), "windows should pull mac achievement");

const beforeRepeatIds = windows.ledger.entries.map((entry) => entry.id).sort().join(",");
status = await windows.service.syncCloudTree();
assert(!status.error, `repeat sync failed: ${status.error}`);
const afterRepeatIds = windows.ledger.entries.map((entry) => entry.id).sort().join(",");
assert(afterRepeatIds === beforeRepeatIds, "repeat sync should not duplicate entries");

windows.ledger.settings.leaderboardEnabled = true;
windows.ledger.settings.cloudSyncEnabled = true;
status = await windows.service.logout();
assert(!status.joined, "leaving leaderboard should disable leaderboard membership");
assert(status.authenticated, "leaving leaderboard should keep GitHub auth for cloud sync");
assert(windows.ledger.settings.cloudSyncEnabled === true, "leaving leaderboard should keep cloud sync enabled");
assert(cloud.leaderboardDeleteCount === 1, "leaving leaderboard should call the leaderboard-only delete endpoint");
assert(cloud.events.size === 2, "leaving leaderboard must not delete cloud tree events");
assert(cloud.achievements.size === 2, "leaving leaderboard must not delete cloud tree achievements");

const cacheCloud = createFakeCloud();
cacheCloud.events.set("codex-session:cache-heavy", {
  id: "codex-session:cache-heavy",
  createdAt: "2026-05-27T03:00:00.000Z",
  source: "codex-session",
  tokens: 1100,
  inputTokens: 1000,
  outputTokens: 100,
  cacheReadTokens: 900,
  cacheWriteTokens: 0,
  deviceId: "win-device",
});
const pollutedMac = createDevice("polluted-mac", "polluted-mac-device", cacheCloud, {
  entries: [
    {
      id: "codex-session:cache-heavy",
      createdAt: "2026-05-27T03:00:00.000Z",
      source: "cloud-sync",
      tokens: 2000,
      inputTokens: 1000,
      outputTokens: 100,
      cacheReadTokens: 900,
      cacheWriteTokens: 0,
      deviceId: "win-device",
      syncedFromCloud: true,
    },
  ],
});
pollutedMac.ledger.settings.cloudSyncEnabled = true;
pollutedMac.ledger.settings.treeStartMode = "cloud";
status = await pollutedMac.service.syncCloudTree({ force: true, pullFirst: true });
assert(!status.error, `polluted cache repair sync failed: ${status.error}`);
const repaired = pollutedMac.ledger.entries.find((entry) => entry.id === "codex-session:cache-heavy");
assert(repaired?.tokens === 1100, "cloud-sync repair should trust authoritative server tokens");
assert(countedTokensForEntry(repaired) === 1100, "cloud-sync XP should not add cache read twice");
assert(repaired.source === "codex-session", "cloud-sync repair should restore the safe source category");

console.log(
  "Cloud sync contract verified: two-device merge, dedupe, authoritative cloud tokens, empty-account guard, leaderboard leave safety, and privacy payload whitelist passed.",
);
