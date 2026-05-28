import * as http from "node:http";
import * as https from "node:https";
import { createHash, randomBytes } from "node:crypto";
import type {
  AchievementState,
  AchievementUnlock,
  CloudDeviceSummary,
  CloudModelStat,
  CloudSyncStatus,
  LedgerEntry,
  LedgerFile,
  LeaderboardCollection,
  LeaderboardData,
  LeaderboardEntry,
  LeaderboardPreferencePeriod,
  LeaderboardProfile,
  LeaderboardRange,
  LeaderboardStatus,
  LeaderboardUsagePreference,
  Settings,
} from "../shared/types.js";

interface LeaderboardAuthFile {
  token?: string;
  profile?: LeaderboardProfile;
  createdAt?: string;
}

interface LeaderboardAuthSessionResponse {
  token?: string;
}

interface CloudSyncFile {
  syncedEntryIds?: string[];
  syncedEventFingerprints?: string[];
  syncedAchievementIds?: string[];
  lastUploadedCount?: number;
  lastDownloadedCount?: number;
  devices?: CloudDeviceSummary[];
  modelStats?: CloudModelStat[];
}

interface CloudTreeResponse {
  entries?: unknown[];
  achievements?: unknown[];
  devices?: unknown[];
  modelStats?: unknown[];
  summary?: {
    hasRemoteTree?: boolean;
  };
}

interface CloudDeviceInfo {
  deviceId: string;
  alias?: string;
  platform?: string;
}

export interface LeaderboardRequestJsonOptions {
  method?: string;
  token?: string;
  body?: unknown;
  timeoutMs?: number;
}

export type LeaderboardRequestJson = <T = unknown>(
  urlString: string,
  options?: LeaderboardRequestJsonOptions,
) => Promise<T>;

interface LeaderboardServiceOptions {
  apiUrl: string;
  appName: string;
  syncIntervalMs: number;
  authTimeoutMs: number;
  callbackPath: string;
  authPath: () => string;
  cloudSyncPath: () => string;
  deviceId: () => string;
  deviceInfo: () => CloudDeviceInfo;
  cloudModelStats: () => CloudModelStat[];
  getLedger: () => LedgerFile;
  getAchievements: () => AchievementState;
  updateSettings: (partial: Partial<Settings>) => void;
  appendRemoteEntries: (entries: LedgerEntry[]) => number;
  mergeRemoteAchievements: (unlocked: AchievementUnlock[]) => number;
  xpForEntry: (entry: LedgerEntry) => number;
  dateKey: (date: Date) => string;
  currentAppVersion: () => string;
  mainText: (key: string) => string;
  openExternal: (url: string) => Promise<void>;
  readJsonFile: <T>(path: string) => T | undefined;
  writeJsonAtomic: (path: string, value: unknown) => void;
  broadcastStatus: (status: LeaderboardStatus) => void;
  requestJson?: LeaderboardRequestJson;
}

export interface LeaderboardSyncOptions {
  force?: boolean;
}

export function createLeaderboardService(options: LeaderboardServiceOptions) {
  let auth: LeaderboardAuthFile = {};
  let syncTimer: ReturnType<typeof setTimeout> | null = null;
  let cloudSyncTimer: ReturnType<typeof setTimeout> | null = null;
  let syncing = false;
  let cloudSyncing = false;
  let lastCloudUploadedCount = 0;
  let lastCloudDownloadedCount = 0;
  let authServer: http.Server | null = null;
  let lastSyncAttemptAt: string | undefined;

  const configured = Boolean(options.apiUrl);
  const ledger = () => options.getLedger();
  const text = (key: string) => options.mainText(key);
  const requestJson: LeaderboardRequestJson = (urlString, requestOptions) =>
    options.requestJson ? options.requestJson(urlString, requestOptions) : defaultRequestJson(urlString, requestOptions);

  function readAuth() {
    auth = normalizeAuth(options.readJsonFile<LeaderboardAuthFile>(options.authPath()));
    return auth;
  }

  function writeAuth(nextAuth = auth) {
    auth = normalizeAuth(nextAuth);
    options.writeJsonAtomic(options.authPath(), auth);
  }

  function clearAuth() {
    auth = {};
    options.writeJsonAtomic(options.authPath(), {});
  }

  function status(error?: string): LeaderboardStatus {
    const authenticated = Boolean(auth.token && auth.profile);
    const profile = authenticated ? auth.profile : ledger().settings.leaderboardProfile;
    return {
      configured,
      authenticated,
      joined: Boolean(ledger().settings.leaderboardEnabled && authenticated),
      syncing,
      profile,
      lastSyncedAt: ledger().settings.leaderboardLastSyncedAt,
      error,
    };
  }

  function broadcast(error?: string) {
    options.broadcastStatus(status(error));
  }

  function startSync() {
    scheduleNextSync();
    scheduleCloudSyncSoon();
    broadcast();
  }

  function stop() {
    if (syncTimer) clearTimeout(syncTimer);
    if (cloudSyncTimer) clearTimeout(cloudSyncTimer);
    syncTimer = null;
    cloudSyncTimer = null;
    authServer?.close();
    authServer = null;
  }

  function scheduleNextSync() {
    if (syncTimer) {
      clearTimeout(syncTimer);
      syncTimer = null;
    }

    if (!configured || !auth.token || !ledger().settings.leaderboardEnabled) return;

    syncTimer = setTimeout(() => {
      syncTimer = null;
      void syncUsage();
    }, nextSyncDelay());
  }

  function scheduleCloudSyncSoon(delayMs = 3_000) {
    if (cloudSyncTimer) {
      clearTimeout(cloudSyncTimer);
      cloudSyncTimer = null;
    }
    if (!configured || !auth.token || !ledger().settings.cloudSyncEnabled) return;
    cloudSyncTimer = setTimeout(() => {
      cloudSyncTimer = null;
      void syncCloudTree();
    }, delayMs);
  }

  function cloudStatus(error?: string): CloudSyncStatus {
    const authenticated = Boolean(auth.token && auth.profile);
    const state = readCloudSyncState();
    return {
      configured,
      authenticated,
      enabled: Boolean(ledger().settings.cloudSyncEnabled && authenticated),
      syncing: cloudSyncing,
      hasRemoteTree: state.syncedEntryIds?.length || state.syncedAchievementIds?.length ? true : undefined,
      deviceId: ledger().settings.cloudSyncDeviceId,
      profile: authenticated ? auth.profile : ledger().settings.leaderboardProfile,
      lastSyncedAt: ledger().settings.cloudSyncLastSyncedAt,
      lastPulledAt: ledger().settings.cloudSyncLastPulledAt,
      lastUploadedCount: lastCloudUploadedCount || state.lastUploadedCount,
      lastDownloadedCount: lastCloudDownloadedCount || state.lastDownloadedCount,
      devices: state.devices,
      modelStats: state.modelStats,
      error,
    };
  }

  function nextSyncDelay() {
    const lastSyncedAt = ledger().settings.leaderboardLastSyncedAt ?? lastSyncAttemptAt;
    if (!lastSyncedAt) return Math.min(3_000, options.syncIntervalMs);
    const lastSyncedTime = Date.parse(lastSyncedAt);
    if (!Number.isFinite(lastSyncedTime)) return Math.min(3_000, options.syncIntervalMs);
    return Math.max(3_000, lastSyncedTime + options.syncIntervalMs - Date.now());
  }

  async function login(): Promise<LeaderboardStatus> {
    if (!configured) return status(text("leaderboardServiceNotConfigured"));

    try {
      const profile = await authenticate();
      options.updateSettings({
        leaderboardEnabled: true,
        leaderboardProfile: profile,
      });
      return await syncUsage({ force: true });
    } catch (error) {
      return status(error instanceof Error ? error.message : text("leaderboardLoginFailed"));
    }
  }

  async function authenticate() {
    if (auth.token && auth.profile) return auth.profile;
    const token = await waitForToken();
    const profile = await fetchProfile(token);
    writeAuth({
      token,
      profile,
      createdAt: new Date().toISOString(),
    });
    options.updateSettings({
      leaderboardProfile: profile,
    });
    return profile;
  }

  async function setEnabled(enabled: boolean): Promise<LeaderboardStatus> {
    if (enabled && !configured) return status(text("leaderboardServiceNotConfigured"));
    if (enabled && !auth.token) return status(text("leaderboardLoginRequired"));

    options.updateSettings({
      leaderboardEnabled: enabled,
      leaderboardProfile: enabled ? auth.profile : ledger().settings.leaderboardProfile,
    });
    if (enabled) return await syncUsage({ force: true });
    return status();
  }

  async function logout(): Promise<LeaderboardStatus> {
    const token = auth.token;
    if (token && configured) {
      try {
        await requestJson(apiUrl("/api/leaderboard"), { method: "DELETE", token });
      } catch (error) {
        return status(error instanceof Error ? error.message : text("leaderboardSyncFailed"));
      }
    }
    options.updateSettings({
      leaderboardEnabled: false,
      leaderboardLastSyncedAt: undefined,
      leaderboardPreferencesPublic: false,
    });
    return status(text("leaderboardLoggedOut"));
  }

  async function syncUsage(syncOptions: LeaderboardSyncOptions = {}): Promise<LeaderboardStatus> {
    if (!configured) return status(text("leaderboardServiceNotConfigured"));
    if (!auth.token || !auth.profile) return status(text("leaderboardLoginRequired"));
    if (!ledger().settings.leaderboardEnabled) return status();
    if (syncing) return status();

    syncing = true;
    lastSyncAttemptAt = new Date().toISOString();
    broadcast();

    try {
      await requestJson(apiUrl("/api/usage/daily"), {
        method: "POST",
        token: auth.token,
        body: {
          days: dailyUsage(),
          appVersion: options.currentAppVersion(),
          usageStartDate: usageStartDate(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          forceSync: syncOptions.force === true,
          usagePreferencesPublic: ledger().settings.leaderboardPreferencesPublic,
          usagePreferences: ledger().settings.leaderboardPreferencesPublic ? usagePreferences() : undefined,
        },
      });
      syncing = false;
      options.updateSettings({
        leaderboardEnabled: true,
        leaderboardProfile: auth.profile,
        leaderboardLastSyncedAt: new Date().toISOString(),
      });
      scheduleNextSync();
      broadcast();
      return status();
    } catch (error) {
      syncing = false;
      scheduleNextSync();
      const message = error instanceof Error ? error.message : text("leaderboardSyncFailed");
      broadcast(message);
      return status(message);
    }
  }

  async function enableCloudSync(): Promise<CloudSyncStatus> {
    if (!configured) return cloudStatus(text("leaderboardServiceNotConfigured"));
    try {
      const profile = await authenticate();
      const deviceId = options.deviceId();
      options.updateSettings({
        cloudSyncEnabled: true,
        cloudSyncDeviceId: deviceId,
        leaderboardProfile: profile,
        treeStartMode: ledger().settings.treeStartMode ?? "new",
      });
      return await syncCloudTree({ force: true });
    } catch (error) {
      return cloudStatus(error instanceof Error ? error.message : text("leaderboardLoginFailed"));
    }
  }

  async function joinCloudTree(): Promise<CloudSyncStatus> {
    if (!configured) return cloudStatus(text("leaderboardServiceNotConfigured"));
    try {
      const profile = await authenticate();
      options.updateSettings({
        cloudSyncEnabled: true,
        cloudSyncDeviceId: options.deviceId(),
        leaderboardProfile: profile,
      });
      const result = await syncCloudTree({ force: true, pullFirst: true, requireRemote: true });
      if (result.error) {
        options.updateSettings({ cloudSyncEnabled: false });
        return cloudStatus(result.error);
      }
      return result;
    } catch (error) {
      return cloudStatus(error instanceof Error ? error.message : text("leaderboardLoginFailed"));
    }
  }

  async function syncCloudTree(
    syncOptions: { force?: boolean; pullFirst?: boolean; requireRemote?: boolean } = {},
  ): Promise<CloudSyncStatus> {
    if (!configured) return cloudStatus(text("leaderboardServiceNotConfigured"));
    if (!auth.token || !auth.profile) return cloudStatus(text("leaderboardLoginRequired"));
    if (!ledger().settings.cloudSyncEnabled) return cloudStatus();
    if (cloudSyncing) return cloudStatus();

    cloudSyncing = true;
    let state = readCloudSyncState();
    let uploadedCount = 0;
    let downloadedCount = 0;

    try {
      if (syncOptions.pullFirst) {
        const pulled = await pullCloudTree();
        if (syncOptions.requireRemote && !pulled.hasRemoteTree) {
          throw new Error(text("cloudSyncNoRemoteTree"));
        }
        downloadedCount += pulled.downloaded;
        state = mergeCloudState(state, pulled.entries, pulled.achievements, pulled.devices, pulled.modelStats);
      }

      await syncCloudDeviceSnapshot();

      const syncedEntryIds = new Set(syncOptions.force && !syncOptions.pullFirst ? [] : state.syncedEntryIds ?? []);
      const syncedEventFingerprints = new Set(state.syncedEventFingerprints ?? []);
      const localEntries = ledger().entries.filter((entry) => {
        if (isCloudSyncedEntry(entry) || syncedEntryIds.has(entry.id)) return false;
        const fingerprint = cloudEventFingerprint(entry);
        return !fingerprint || !syncedEventFingerprints.has(fingerprint);
      });
      for (const chunk of chunkArray(localEntries, 500)) {
        if (!chunk.length) continue;
        await requestJson(apiUrl("/api/tree/events"), {
          method: "POST",
          token: auth.token,
          body: {
            deviceId: options.deviceId(),
            entries: chunk.map((entry) => cloudEntry(entry, options.deviceId())),
            appVersion: options.currentAppVersion(),
          },
        });
        uploadedCount += chunk.length;
        for (const entry of chunk) {
          syncedEntryIds.add(entry.id);
          const fingerprint = cloudEventFingerprint(entry);
          if (fingerprint) syncedEventFingerprints.add(fingerprint);
        }
      }

      const syncedAchievementIds = new Set(syncOptions.force ? [] : state.syncedAchievementIds ?? []);
      const localAchievements = options.getAchievements().unlocked.filter((item) => !syncedAchievementIds.has(item.id));
      if (localAchievements.length) {
        await requestJson(apiUrl("/api/tree/achievements"), {
          method: "POST",
          token: auth.token,
          body: {
            achievements: localAchievements.map(cloudAchievement),
            appVersion: options.currentAppVersion(),
          },
        });
        for (const achievement of localAchievements) syncedAchievementIds.add(achievement.id);
      }

      const pulled = await pullCloudTree();
      downloadedCount += pulled.downloaded;
      state = mergeCloudState(
        {
          ...state,
          syncedEntryIds: [...syncedEntryIds],
          syncedEventFingerprints: [...syncedEventFingerprints],
          syncedAchievementIds: [...syncedAchievementIds],
        },
        pulled.entries,
        pulled.achievements,
        pulled.devices,
        pulled.modelStats,
      );

      lastCloudUploadedCount = uploadedCount;
      lastCloudDownloadedCount = downloadedCount;
      writeCloudSyncState({
        ...state,
        lastUploadedCount: uploadedCount,
        lastDownloadedCount: downloadedCount,
      });
      options.updateSettings({
        cloudSyncEnabled: true,
        cloudSyncDeviceId: options.deviceId(),
        cloudSyncLastSyncedAt: new Date().toISOString(),
        cloudSyncLastPulledAt: new Date().toISOString(),
      });
      cloudSyncing = false;
      return cloudStatus();
    } catch (error) {
      cloudSyncing = false;
      if (!syncOptions.requireRemote) scheduleCloudSyncSoon(30_000);
      return cloudStatus(error instanceof Error ? error.message : text("leaderboardSyncFailed"));
    }
  }

  async function getLeaderboard(rangeInput: unknown): Promise<LeaderboardData> {
    const range = normalizeRange(rangeInput);
    if (!configured) {
      return {
        range,
        entries: [],
        error: text("leaderboardServiceNotConfigured"),
      };
    }

    try {
      const url = new URL(apiUrl("/api/leaderboard"));
      url.searchParams.set("range", range);
      const data = await requestJson<unknown>(url.toString(), { token: auth.token });
      return normalizeData(data, range);
    } catch (error) {
      return {
        range,
        entries: [],
        error: error instanceof Error ? error.message : text("leaderboardLoadFailed"),
      };
    }
  }

  async function getLeaderboards(): Promise<LeaderboardCollection> {
    if (!configured) {
      return collectionWithError(text("leaderboardServiceNotConfigured"));
    }

    try {
      const data = await requestJson<unknown>(apiUrl("/api/leaderboards"), { token: auth.token });
      return normalizeCollection(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : text("leaderboardLoadFailed");
      if (message === "Not found" || message.includes("(404)")) return getLeaderboardsByRange();
      return collectionWithError(message);
    }
  }

  async function getLeaderboardsByRange(): Promise<LeaderboardCollection> {
    const results = await Promise.all(LEADERBOARD_PREFERENCE_RANGES.map((range) => getLeaderboard(range)));
    const ranges = Object.fromEntries(results.map((data) => [data.range, data])) as Record<
      LeaderboardRange,
      LeaderboardData
    >;
    return { ranges };
  }

  async function pullCloudTree() {
    const data = await requestJson<CloudTreeResponse>(apiUrl("/api/tree"), { token: auth.token });
    const entries = normalizeCloudEntries(data.entries ?? []);
    const achievements = normalizeCloudAchievements(data.achievements ?? []);
    const devices = normalizeCloudDevices(data.devices ?? []);
    const modelStats = normalizeCloudModelStats(data.modelStats ?? []);
    const downloaded = options.appendRemoteEntries(entries);
    options.mergeRemoteAchievements(achievements);
    const hasRemoteTree = Boolean(
      data.summary?.hasRemoteTree ?? (entries.length > 0 || achievements.length > 0 || devices.length > 0 || modelStats.length > 0),
    );
    return { entries, achievements, devices, modelStats, downloaded, hasRemoteTree };
  }

  async function syncCloudDeviceSnapshot() {
    await requestJson(apiUrl("/api/tree/events"), {
      method: "POST",
      token: auth.token,
      body: {
        deviceId: options.deviceId(),
        device: options.deviceInfo(),
        entries: [],
        modelStats: options.cloudModelStats(),
        appVersion: options.currentAppVersion(),
      },
    });
  }

  function readCloudSyncState(): CloudSyncFile {
    const state = options.readJsonFile<CloudSyncFile>(options.cloudSyncPath());
    return {
      syncedEntryIds: Array.isArray(state?.syncedEntryIds)
        ? state.syncedEntryIds.filter((id): id is string => typeof id === "string")
        : [],
      syncedEventFingerprints: Array.isArray(state?.syncedEventFingerprints)
        ? state.syncedEventFingerprints.filter((id): id is string => typeof id === "string")
        : [],
      syncedAchievementIds: Array.isArray(state?.syncedAchievementIds)
        ? state.syncedAchievementIds.filter((id): id is string => typeof id === "string")
        : [],
      lastUploadedCount: positiveInteger(state?.lastUploadedCount),
      lastDownloadedCount: positiveInteger(state?.lastDownloadedCount),
      devices: normalizeCloudDevices(state?.devices ?? []),
      modelStats: normalizeCloudModelStats(state?.modelStats ?? []),
    };
  }

  function writeCloudSyncState(state: CloudSyncFile) {
    options.writeJsonAtomic(options.cloudSyncPath(), {
      syncedEntryIds: [...new Set(state.syncedEntryIds ?? [])],
      syncedEventFingerprints: [...new Set(state.syncedEventFingerprints ?? [])],
      syncedAchievementIds: [...new Set(state.syncedAchievementIds ?? [])],
      lastUploadedCount: positiveInteger(state.lastUploadedCount) ?? 0,
      lastDownloadedCount: positiveInteger(state.lastDownloadedCount) ?? 0,
      devices: normalizeCloudDevices(state.devices ?? []),
      modelStats: normalizeCloudModelStats(state.modelStats ?? []),
    });
  }

  function mergeCloudState(
    state: CloudSyncFile,
    entries: LedgerEntry[],
    achievements: AchievementUnlock[],
    devices: CloudDeviceSummary[] = state.devices ?? [],
    modelStats: CloudModelStat[] = state.modelStats ?? [],
  ) {
    return {
      ...state,
      syncedEntryIds: [
        ...new Set([...(state.syncedEntryIds ?? []), ...entries.map((entry) => entry.id)]),
      ],
      syncedEventFingerprints: [
        ...new Set([
          ...(state.syncedEventFingerprints ?? []),
          ...entries.map(cloudEventFingerprint).filter((value): value is string => Boolean(value)),
        ]),
      ],
      syncedAchievementIds: [
        ...new Set([...(state.syncedAchievementIds ?? []), ...achievements.map((item) => item.id)]),
      ],
      devices,
      modelStats,
    };
  }

  function waitForToken(): Promise<string> {
    const state = crypto.randomUUID();
    const codeVerifier = randomPkceValue();
    const codeChallenge = codeChallengeForVerifier(codeVerifier);

    return new Promise((resolve, reject) => {
      if (authServer) {
        authServer.close();
        authServer = null;
      }

      let settled = false;
      let callbackUrl = "";
      let timeout: ReturnType<typeof setTimeout>;
      const cleanup = () => {
        clearTimeout(timeout);
        authServer?.close();
        authServer = null;
      };
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        callback();
        cleanup();
      };
      timeout = setTimeout(() => {
        finish(() => reject(new Error(text("leaderboardLoginTimedOut"))));
      }, options.authTimeoutMs);

      const server = http.createServer((request, response) => {
        void handleCallback(request, response).catch((error) => {
          sendAuthPage(response, 400, text("leaderboardLoginFailed"));
          finish(() => reject(error instanceof Error ? error : new Error(text("leaderboardLoginFailed"))));
        });
      });

      async function handleCallback(request: http.IncomingMessage, response: http.ServerResponse) {
        const requestUrl = new URL(request.url ?? "/", callbackUrl || "http://127.0.0.1");
        if (requestUrl.pathname !== options.callbackPath) {
          sendAuthPage(response, 404, text("leaderboardLoginFailed"));
          return;
        }

        if (requestUrl.searchParams.get("state") !== state) {
          sendAuthPage(response, 400, text("leaderboardLoginFailed"));
          finish(() => reject(new Error(text("leaderboardLoginFailed"))));
          return;
        }

        const error = requestUrl.searchParams.get("error");
        if (error) {
          sendAuthPage(response, 400, text("leaderboardLoginFailed"));
          finish(() => reject(new Error(error)));
          return;
        }

        const code = requestUrl.searchParams.get("code") || "";
        if (!isPkceValue(code)) {
          sendAuthPage(response, 400, text("leaderboardLoginFailed"));
          finish(() => reject(new Error(text("leaderboardLoginFailed"))));
          return;
        }

        const token = await exchangeAuthCode(code, codeVerifier);
        sendAuthPage(response, 200, text("leaderboardLoginComplete"));
        finish(() => resolve(token));
      }

      authServer = server;
      server.on("error", (error) => finish(() => reject(error)));
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : 0;
        callbackUrl = `http://127.0.0.1:${port}${options.callbackPath}`;
        const authUrl = new URL(apiUrl("/auth/github/start"));
        authUrl.searchParams.set("callback", callbackUrl);
        authUrl.searchParams.set("state", state);
        authUrl.searchParams.set("code_challenge", codeChallenge);
        options.openExternal(authUrl.toString()).catch((error) => finish(() => reject(error)));
      });
    });
  }

  function sendAuthPage(response: http.ServerResponse, statusCode: number, message: string) {
    response.writeHead(statusCode, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><meta charset="utf-8"><title>Vibe Tree</title><body style="font-family:system-ui;background:#171927;color:#f3f4ff;padding:32px"><h1>${escapeHtml(message)}</h1><p>${escapeHtml(text("leaderboardLoginPageHint"))}</p></body>`);
  }

  async function fetchProfile(token: string): Promise<LeaderboardProfile> {
    const response = await requestJson<unknown>(apiUrl("/api/me"), { token });
    const profile = normalizeProfile((response as { profile?: unknown })?.profile ?? response);
    if (!profile) throw new Error(text("leaderboardProfileFailed"));
    return profile;
  }

  async function exchangeAuthCode(code: string, codeVerifier: string) {
    const response = await requestJson<LeaderboardAuthSessionResponse>(apiUrl("/auth/session"), {
      method: "POST",
      body: { code, codeVerifier },
    });
    if (typeof response.token !== "string" || !response.token.trim()) {
      throw new Error(text("leaderboardLoginFailed"));
    }
    return response.token.trim();
  }

  function dailyUsage() {
    const byDate = new Map<string, number>();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 29);
    cutoff.setHours(0, 0, 0, 0);

    for (const entry of ledger().entries) {
      const createdAt = new Date(entry.createdAt);
      if (!Number.isFinite(createdAt.getTime()) || createdAt < cutoff) continue;
      const tokens = options.xpForEntry(entry);
      if (!tokens) continue;
      const key = options.dateKey(createdAt);
      byDate.set(key, (byDate.get(key) ?? 0) + tokens);
    }

    return [...byDate.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, tokens]) => {
        const rounded = Math.round(tokens);
        return { date, tokens: rounded, xp: rounded };
      });
  }

  function usagePreferences() {
    return LEADERBOARD_PREFERENCE_RANGES.map((range) => {
      const preference = usagePreferenceForRange(range);
      return preference ? { range, ...preference } : undefined;
    }).filter((item): item is { range: LeaderboardRange } & LeaderboardUsagePreference => Boolean(item));
  }

  function usagePreferenceForRange(range: LeaderboardRange): LeaderboardUsagePreference | undefined {
    const now = new Date();
    const start = preferenceRangeStart(range, now);
    const agentTotals = new Map<string, number>();
    const modelTotals = new Map<string, number>();
    const hourTotals = Array.from({ length: 24 }, () => 0);
    const hourBuckets = new Map<number, number>();
    let totalTokens = 0;

    for (const entry of ledger().entries) {
      const createdAt = new Date(entry.createdAt);
      if (!Number.isFinite(createdAt.getTime())) continue;
      if (start && createdAt < start) continue;
      const tokens = options.xpForEntry(entry);
      if (tokens <= 0) continue;

      totalTokens += tokens;
      const agentLabel = agentLabelForEntry(entry);
      if (agentLabel) agentTotals.set(agentLabel, (agentTotals.get(agentLabel) ?? 0) + tokens);
      const model = cleanPreferenceLabel(entry.model);
      if (model) modelTotals.set(model, (modelTotals.get(model) ?? 0) + tokens);
      hourTotals[createdAt.getHours()] += tokens;
      const hourKey = Math.floor(createdAt.getTime() / 3_600_000);
      hourBuckets.set(hourKey, (hourBuckets.get(hourKey) ?? 0) + tokens);
    }

    if (totalTokens <= 0) return undefined;

    const topAgent = topPreferenceEntry(agentTotals);
    const topModel = topPreferenceEntry(modelTotals);
    const peakHourTokens = Math.max(0, ...hourBuckets.values());
    const favoritePeriod = favoritePreferencePeriod(hourTotals);

    return {
      favoriteAgent: topAgent
        ? {
            label: topAgent.label,
            percent: Math.max(1, Math.min(100, Math.round((topAgent.tokens / totalTokens) * 100))),
          }
        : undefined,
      favoriteModel: topModel?.label,
      favoritePeriod,
      peakTokensPerMinute: Math.max(0, Math.round(peakHourTokens / 60)),
    };
  }

  function usageStartDate() {
    const dates: string[] = [];
    const installedAt = new Date(ledger().installedAt);
    if (Number.isFinite(installedAt.getTime())) dates.push(options.dateKey(installedAt));
    for (const entry of ledger().entries) {
      const createdAt = new Date(entry.createdAt);
      if (Number.isFinite(createdAt.getTime())) dates.push(options.dateKey(createdAt));
    }
    return dates.sort()[0];
  }

  function apiUrl(path: string) {
    return new URL(path.replace(/^\/+/, ""), `${options.apiUrl}/`).toString();
  }

  function defaultRequestJson<T = unknown>(
    urlString: string,
    requestOptions: LeaderboardRequestJsonOptions = {},
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const url = new URL(urlString);
      const method = requestOptions.method ?? (requestOptions.body === undefined ? "GET" : "POST");
      const body = requestOptions.body === undefined ? undefined : JSON.stringify(requestOptions.body);
      const headers: Record<string, string> = {
        Accept: "application/json",
        "User-Agent": `${options.appName}/${options.currentAppVersion()}`,
      };
      if (body !== undefined) {
        headers["Content-Type"] = "application/json";
        headers["Content-Length"] = String(Buffer.byteLength(body));
      }
      if (requestOptions.token) headers.Authorization = `Bearer ${requestOptions.token}`;

      const transportRequest = url.protocol === "http:" ? http.request : https.request;
      const request = transportRequest(
        url,
        {
          method,
          headers,
          timeout: requestOptions.timeoutMs ?? 10_000,
        },
        (response) => {
          let raw = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => {
            raw += chunk;
            if (raw.length > 1_024_000) {
              request.destroy(new Error(text("leaderboardResponseTooLarge")));
            }
          });
          response.on("end", () => {
            let parsed: unknown = {};
            if (raw.trim()) {
              try {
                parsed = JSON.parse(raw);
              } catch {
                reject(new Error(text("leaderboardResponseParseFailed")));
                return;
              }
            }

            if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
              const message =
                typeof (parsed as { error?: unknown })?.error === "string"
                  ? (parsed as { error: string }).error
                  : `${text("leaderboardRequestFailed")} (${response.statusCode ?? "unknown"})`;
              reject(new Error(message));
              return;
            }

            resolve(parsed as T);
          });
        },
      );
      request.on("timeout", () => request.destroy(new Error(text("leaderboardRequestTimedOut"))));
      request.on("error", reject);
      if (body !== undefined) request.write(body);
      request.end();
    });
  }

  return {
    readAuth,
    startSync,
    stop,
    status,
    broadcast,
    login,
    logout,
    setEnabled,
    syncUsage,
    cloudStatus,
    enableCloudSync,
    joinCloudTree,
    syncCloudTree,
    scheduleCloudSyncSoon,
    getLeaderboard,
    getLeaderboards,
  };
}

function normalizeAuth(auth: Partial<LeaderboardAuthFile> | undefined): LeaderboardAuthFile {
  const token = typeof auth?.token === "string" && auth.token.trim() ? auth.token.trim() : undefined;
  const profile = normalizeProfile(auth?.profile);
  const createdAt =
    typeof auth?.createdAt === "string" && Number.isFinite(Date.parse(auth.createdAt)) ? auth.createdAt : undefined;
  return token && profile ? { token, profile, createdAt } : {};
}

function normalizeProfile(value: unknown): LeaderboardProfile | undefined {
  const profile = value as Partial<LeaderboardProfile> | undefined;
  const id = typeof profile?.id === "string" && profile.id.trim() ? profile.id.trim() : undefined;
  const username =
    typeof profile?.username === "string" && profile.username.trim() ? profile.username.trim() : undefined;
  if (!id || !username) return undefined;
  const avatarUrl =
    typeof profile?.avatarUrl === "string" && profile.avatarUrl.trim() ? profile.avatarUrl.trim() : undefined;
  return { id, username, avatarUrl };
}

function cloudEntry(entry: LedgerEntry, deviceId: string) {
  return {
    id: entry.id,
    createdAt: entry.createdAt,
    source: normalizeCloudEventSource(entry.source, entry.id),
    tokens: Math.max(0, Math.round(entry.tokens)),
    inputTokens: optionalCount(entry.inputTokens),
    outputTokens: optionalCount(entry.outputTokens),
    cacheReadTokens: optionalCount(entry.cacheReadTokens),
    cacheWriteTokens: optionalCount(entry.cacheWriteTokens),
    deviceId: entry.deviceId || deviceId,
    eventFingerprint: cloudEventFingerprint(entry),
  };
}

function cloudAchievement(item: AchievementUnlock) {
  return {
    id: item.id,
    unlockedAt: item.unlockedAt,
  };
}

function normalizeCloudEntries(values: unknown[]) {
  const entries: LedgerEntry[] = [];
  for (const value of values) {
    const input = value as Partial<LedgerEntry> | undefined;
    if (!input || typeof input.id !== "string" || typeof input.createdAt !== "string") continue;
    if (!Number.isFinite(Date.parse(input.createdAt))) continue;
    entries.push({
      id: input.id,
      createdAt: input.createdAt,
      source: normalizeCloudEventSource(input.source, input.id),
      tokens: optionalCount(input.tokens) ?? 0,
      inputTokens: optionalCount(input.inputTokens),
      outputTokens: optionalCount(input.outputTokens),
      cacheReadTokens: optionalCount(input.cacheReadTokens),
      cacheWriteTokens: optionalCount(input.cacheWriteTokens),
      deviceId: cleanOptionalString(input.deviceId, 80),
      syncedFromCloud: true,
      eventFingerprint:
        cleanOptionalString(input.eventFingerprint, 240) ??
        cloudEventFingerprint({
          id: input.id,
          createdAt: input.createdAt,
          source: normalizeCloudEventSource(input.source, input.id),
          tokens: optionalCount(input.tokens) ?? 0,
          inputTokens: optionalCount(input.inputTokens),
          outputTokens: optionalCount(input.outputTokens),
          cacheReadTokens: optionalCount(input.cacheReadTokens),
          cacheWriteTokens: optionalCount(input.cacheWriteTokens),
        }),
    });
  }
  return entries;
}

function normalizeCloudDevices(values: unknown[]) {
  const devices: CloudDeviceSummary[] = [];
  for (const value of values) {
    const input = value as Partial<CloudDeviceSummary> | undefined;
    const deviceId = cleanOptionalString(input?.deviceId, 80);
    if (!deviceId) continue;
    const lastSyncedAt =
      typeof input?.lastSyncedAt === "string" && Number.isFinite(Date.parse(input.lastSyncedAt))
        ? input.lastSyncedAt
        : undefined;
    devices.push({
      deviceId,
      alias: cleanOptionalString(input?.alias, 64),
      platform: cleanOptionalString(input?.platform, 32),
      lastSyncedAt,
      appVersion: cleanOptionalString(input?.appVersion, 32),
      entryCount: optionalCount(input?.entryCount) ?? 0,
      tokens: optionalCount(input?.tokens) ?? 0,
    });
  }
  return devices.sort((a, b) => b.tokens - a.tokens);
}

function normalizeCloudModelStats(values: unknown[]) {
  const stats: CloudModelStat[] = [];
  for (const value of values) {
    const input = value as Partial<CloudModelStat> | undefined;
    const deviceId = cleanOptionalString(input?.deviceId, 80);
    const date = cleanDateKey(input?.date);
    const source = normalizeCloudEventSource(input?.source);
    const model = cleanOptionalString(input?.model, 64);
    const tokens = optionalCount(input?.tokens) ?? 0;
    if (!deviceId || !date || source === "cloud-sync" || !model || tokens <= 0) continue;
    stats.push({
      deviceId,
      date,
      source,
      model,
      tokens,
      inputTokens: optionalCount(input?.inputTokens),
      outputTokens: optionalCount(input?.outputTokens),
      cacheReadTokens: optionalCount(input?.cacheReadTokens),
      cacheWriteTokens: optionalCount(input?.cacheWriteTokens),
    });
  }
  return stats;
}

function isCloudSyncedEntry(entry: LedgerEntry) {
  return entry.syncedFromCloud === true || entry.source === "cloud-sync";
}

function normalizeCloudEventSource(value: unknown, eventId?: unknown) {
  const source = typeof value === "string" ? value.trim() : "";
  if (SAFE_CLOUD_EVENT_SOURCES.has(source)) return source;
  const inferred = sourceFromEventId(eventId);
  return inferred ?? "cloud-sync";
}

function sourceFromEventId(eventId: unknown) {
  if (typeof eventId !== "string") return undefined;
  const prefix = eventId.includes(":") ? eventId.slice(0, eventId.indexOf(":")) : "";
  return SAFE_CLOUD_EVENT_SOURCES.has(prefix) ? prefix : undefined;
}

function cloudEventFingerprint(entry: Partial<LedgerEntry>) {
  if (!entry.createdAt) return undefined;
  const source = normalizeCloudEventSource(entry.source, entry.id);
  return [
    "v1",
    source,
    entry.createdAt,
    optionalCount(entry.tokens) ?? 0,
    optionalCount(entry.inputTokens) ?? 0,
    optionalCount(entry.outputTokens) ?? 0,
    optionalCount(entry.cacheReadTokens) ?? 0,
    optionalCount(entry.cacheWriteTokens) ?? 0,
  ].join("|");
}

const SAFE_CLOUD_EVENT_SOURCES = new Set([
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

function normalizeCloudAchievements(values: unknown[]) {
  const achievements: AchievementUnlock[] = [];
  for (const value of values) {
    const input = value as Partial<AchievementUnlock> | undefined;
    if (!input || typeof input.id !== "string" || typeof input.unlockedAt !== "string") continue;
    if (!Number.isFinite(Date.parse(input.unlockedAt))) continue;
    achievements.push({
      id: input.id,
      unlockedAt: input.unlockedAt,
    });
  }
  return achievements;
}

function cleanOptionalString(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : undefined;
}

function cleanDateKey(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

function optionalCount(value: unknown) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function positiveInteger(value: unknown) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function normalizeRange(value: unknown): LeaderboardRange {
  return value === "today" || value === "30d" || value === "all" ? value : "7d";
}

const LEADERBOARD_PREFERENCE_RANGES: LeaderboardRange[] = ["today", "7d", "30d", "all"];

const AGENT_LABELS: Record<string, string> = {
  codex: "Codex",
  openclaw: "OpenClaw",
  pi: "Pi Agent",
  opencode: "OpenCode",
  claude: "Claude Code",
  gemini: "Gemini",
  hermes: "Hermes",
  cloud: "Cloud Tree",
};

const PREFERENCE_PERIODS: Array<{
  id: LeaderboardPreferencePeriod;
  startHour: number;
  endHour: number;
  hours: number[];
}> = [
  { id: "early", startHour: 0, endHour: 6, hours: [0, 1, 2, 3, 4, 5] },
  { id: "morning", startHour: 6, endHour: 12, hours: [6, 7, 8, 9, 10, 11] },
  { id: "afternoon", startHour: 12, endHour: 18, hours: [12, 13, 14, 15, 16, 17] },
  { id: "evening", startHour: 18, endHour: 21, hours: [18, 19, 20] },
  { id: "night", startHour: 21, endHour: 24, hours: [21, 22, 23] },
];

function preferenceRangeStart(range: LeaderboardRange, now: Date) {
  if (range === "all") return undefined;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (range === "7d") start.setDate(start.getDate() - 6);
  if (range === "30d") start.setDate(start.getDate() - 29);
  return start;
}

function topPreferenceEntry(values: Map<string, number>) {
  let best: { label: string; tokens: number } | undefined;
  for (const [label, tokens] of values) {
    if (!best || tokens > best.tokens) best = { label, tokens };
  }
  return best;
}

function favoritePreferencePeriod(hourTotals: number[]): LeaderboardUsagePreference["favoritePeriod"] | undefined {
  let best: (typeof PREFERENCE_PERIODS)[number] | undefined;
  let bestTokens = 0;
  for (const period of PREFERENCE_PERIODS) {
    const tokens = period.hours.reduce((sum, hour) => sum + (hourTotals[hour] ?? 0), 0);
    if (tokens > bestTokens) {
      best = period;
      bestTokens = tokens;
    }
  }
  return best && bestTokens > 0
    ? { id: best.id, startHour: best.startHour, endHour: best.endHour }
    : undefined;
}

function agentLabelForEntry(entry: LedgerEntry) {
  const sourceId = preferenceSourceIdForEntry(entry);
  if (sourceId) return AGENT_LABELS[sourceId];
  return cleanPreferenceLabel(entry.agent) || cleanPreferenceLabel(entry.source);
}

function preferenceSourceIdForEntry(entry: LedgerEntry): keyof typeof AGENT_LABELS | undefined {
  if (entry.source === "cloud-sync") return "cloud";
  if (entry.source === "codex-session" || entry.agent === "codex-desktop") return "codex";
  if (entry.source === "openclaw-session" || entry.agent === "openclaw") return "openclaw";
  if (entry.source === "pi-session" || entry.agent === "pi-agent") return "pi";
  if (entry.source === "opencode-session" || entry.agent === "opencode" || Boolean(entry.agent?.startsWith("opencode:"))) {
    return "opencode";
  }
  if (entry.source === "claude-session" || Boolean(entry.agent?.startsWith("claude-code"))) return "claude";
  if (entry.source === "gemini-session" || entry.agent === "gemini") return "gemini";
  if (entry.source === "hermes-session" || entry.agent === "hermes") return "hermes";
  return undefined;
}

function cleanPreferenceLabel(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 64) : undefined;
}

function randomPkceValue() {
  return base64Url(randomBytes(32));
}

function codeChallengeForVerifier(verifier: string) {
  return base64Url(createHash("sha256").update(verifier).digest());
}

function base64Url(value: Buffer) {
  return value.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function isPkceValue(value: string) {
  return /^[A-Za-z0-9_-]{43,128}$/.test(value);
}

function normalizeData(value: unknown, fallbackRange: LeaderboardRange): LeaderboardData {
  const data = value as Partial<LeaderboardData> | undefined;
  const range = normalizeRange(data?.range ?? fallbackRange);
  const entries = Array.isArray(data?.entries)
    ? data.entries.map(normalizeEntry).filter((entry): entry is LeaderboardEntry => Boolean(entry))
    : [];
  const me = normalizeEntry(data?.me);
  const updatedAt =
    typeof data?.updatedAt === "string" && Number.isFinite(Date.parse(data.updatedAt)) ? data.updatedAt : undefined;
  const error = typeof data?.error === "string" ? data.error : undefined;
  return { range, entries, updatedAt, me, error };
}

function normalizeCollection(value: unknown): LeaderboardCollection {
  const collection = value as Partial<LeaderboardCollection> | undefined;
  const rawRanges = collection?.ranges as Partial<Record<LeaderboardRange, unknown>> | undefined;
  const ranges = Object.fromEntries(
    LEADERBOARD_PREFERENCE_RANGES.map((range) => [range, normalizeData(rawRanges?.[range], range)]),
  ) as Record<LeaderboardRange, LeaderboardData>;
  const updatedAt =
    typeof collection?.updatedAt === "string" && Number.isFinite(Date.parse(collection.updatedAt))
      ? collection.updatedAt
      : undefined;
  return { ranges, updatedAt };
}

function collectionWithError(error: string): LeaderboardCollection {
  const ranges = {} as Record<LeaderboardRange, LeaderboardData>;
  for (const range of LEADERBOARD_PREFERENCE_RANGES) {
    ranges[range] = { range, entries: [], error };
  }
  return { ranges };
}

function normalizeEntry(value: unknown): LeaderboardEntry | undefined {
  const entry = value as Partial<LeaderboardEntry> | undefined;
  const rank = Math.max(1, Math.round(Number(entry?.rank)));
  const userId = typeof entry?.userId === "string" && entry.userId.trim() ? entry.userId.trim() : undefined;
  const username = typeof entry?.username === "string" && entry.username.trim() ? entry.username.trim() : undefined;
  const rawTokens = entry?.tokens ?? entry?.xp;
  const tokens = Math.max(0, Math.round(Number(rawTokens)));
  if (!Number.isFinite(rank) || !userId || !username || !Number.isFinite(tokens)) return undefined;
  const avatarUrl =
    typeof entry?.avatarUrl === "string" && entry.avatarUrl.trim() ? entry.avatarUrl.trim() : undefined;
  const daysActive = Number.isFinite(Number(entry?.daysActive))
    ? Math.max(0, Math.round(Number(entry?.daysActive)))
    : undefined;
  const usagePreference = normalizeUsagePreference(entry?.usagePreference);
  return { rank, userId, username, avatarUrl, tokens, xp: tokens, daysActive, usagePreference };
}

function normalizeUsagePreference(value: unknown): LeaderboardUsagePreference | undefined {
  const input = value as Partial<LeaderboardUsagePreference> | undefined;
  if (!input || typeof input !== "object") return undefined;
  const favoriteAgent =
    typeof input.favoriteAgent?.label === "string" && input.favoriteAgent.label.trim()
      ? {
          label: input.favoriteAgent.label.trim().slice(0, 64),
          percent: Math.max(0, Math.min(100, Math.round(Number(input.favoriteAgent.percent)))),
        }
      : undefined;
  const favoriteModel =
    typeof input.favoriteModel === "string" && input.favoriteModel.trim()
      ? input.favoriteModel.trim().slice(0, 64)
      : undefined;
  const period = input.favoritePeriod;
  const favoritePeriod =
    period &&
    (period.id === "early" ||
      period.id === "morning" ||
      period.id === "afternoon" ||
      period.id === "evening" ||
      period.id === "night") &&
    Number.isFinite(Number(period.startHour)) &&
    Number.isFinite(Number(period.endHour))
      ? {
          id: period.id,
          startHour: Math.max(0, Math.min(23, Math.round(Number(period.startHour)))),
          endHour: Math.max(1, Math.min(24, Math.round(Number(period.endHour)))),
        }
      : undefined;
  const peakTokensPerMinute = Number.isFinite(Number(input.peakTokensPerMinute))
    ? Math.max(0, Math.round(Number(input.peakTokensPerMinute)))
    : undefined;
  const updatedAt =
    typeof input.updatedAt === "string" && Number.isFinite(Date.parse(input.updatedAt)) ? input.updatedAt : undefined;
  if (!favoriteAgent && !favoriteModel && !favoritePeriod && !peakTokensPerMinute) return undefined;
  return { favoriteAgent, favoriteModel, favoritePeriod, peakTokensPerMinute, updatedAt };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[char] ?? char;
  });
}
