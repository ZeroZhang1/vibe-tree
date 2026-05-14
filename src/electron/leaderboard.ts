import * as http from "node:http";
import * as https from "node:https";
import { createHash, randomBytes } from "node:crypto";
import type {
  LedgerEntry,
  LedgerFile,
  LeaderboardData,
  LeaderboardEntry,
  LeaderboardProfile,
  LeaderboardRange,
  LeaderboardStatus,
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
  getLedger: () => LedgerFile;
  updateSettings: (partial: Partial<Settings>) => void;
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

export function createLeaderboardService(options: LeaderboardServiceOptions) {
  let auth: LeaderboardAuthFile = {};
  let syncTimer: ReturnType<typeof setInterval> | null = null;
  let syncing = false;
  let authServer: http.Server | null = null;

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
    if (syncTimer) {
      clearInterval(syncTimer);
      syncTimer = null;
    }

    if (!configured || !auth.token || !ledger().settings.leaderboardEnabled) {
      broadcast();
      return;
    }

    syncTimer = setInterval(() => {
      void syncUsage();
    }, options.syncIntervalMs);
    broadcast();
  }

  function stop() {
    if (syncTimer) clearInterval(syncTimer);
    syncTimer = null;
    authServer?.close();
    authServer = null;
  }

  async function login(): Promise<LeaderboardStatus> {
    if (!configured) return status(text("leaderboardServiceNotConfigured"));

    try {
      const token = await waitForToken();
      const profile = await fetchProfile(token);
      writeAuth({
        token,
        profile,
        createdAt: new Date().toISOString(),
      });
      options.updateSettings({
        leaderboardEnabled: true,
        leaderboardProfile: profile,
      });
      void syncUsage();
      return status();
    } catch (error) {
      return status(error instanceof Error ? error.message : text("leaderboardLoginFailed"));
    }
  }

  async function setEnabled(enabled: boolean): Promise<LeaderboardStatus> {
    if (enabled && !configured) return status(text("leaderboardServiceNotConfigured"));
    if (enabled && !auth.token) return status(text("leaderboardLoginRequired"));

    options.updateSettings({
      leaderboardEnabled: enabled,
      leaderboardProfile: enabled ? auth.profile : ledger().settings.leaderboardProfile,
    });
    if (enabled) void syncUsage();
    return status();
  }

  async function logout(): Promise<LeaderboardStatus> {
    const token = auth.token;
    if (token && configured) {
      try {
        await requestJson(apiUrl("/api/me"), { method: "DELETE", token });
      } catch {
        // Local opt-out should still succeed even if the remote service is unavailable.
      }
    }
    clearAuth();
    options.updateSettings({
      leaderboardEnabled: false,
      leaderboardProfile: undefined,
      leaderboardLastSyncedAt: undefined,
    });
    return status(text("leaderboardLoggedOut"));
  }

  async function syncUsage(): Promise<LeaderboardStatus> {
    if (!configured) return status(text("leaderboardServiceNotConfigured"));
    if (!auth.token || !auth.profile) return status(text("leaderboardLoginRequired"));
    if (!ledger().settings.leaderboardEnabled) return status();
    if (syncing) return status();

    syncing = true;
    broadcast();

    try {
      await requestJson(apiUrl("/api/usage/daily"), {
        method: "POST",
        token: auth.token,
        body: {
          days: dailyUsage(),
          appVersion: options.currentAppVersion(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      });
      syncing = false;
      options.updateSettings({
        leaderboardEnabled: true,
        leaderboardProfile: auth.profile,
        leaderboardLastSyncedAt: new Date().toISOString(),
      });
      broadcast();
      return status();
    } catch (error) {
      syncing = false;
      const message = error instanceof Error ? error.message : text("leaderboardSyncFailed");
      broadcast(message);
      return status(message);
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
      const xp = options.xpForEntry(entry);
      if (!xp) continue;
      const key = options.dateKey(createdAt);
      byDate.set(key, (byDate.get(key) ?? 0) + xp);
    }

    return [...byDate.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, xp]) => ({ date, xp: Math.round(xp) }));
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
    getLeaderboard,
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

function normalizeRange(value: unknown): LeaderboardRange {
  return value === "today" || value === "30d" || value === "all" ? value : "7d";
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

function normalizeEntry(value: unknown): LeaderboardEntry | undefined {
  const entry = value as Partial<LeaderboardEntry> | undefined;
  const rank = Math.max(1, Math.round(Number(entry?.rank)));
  const userId = typeof entry?.userId === "string" && entry.userId.trim() ? entry.userId.trim() : undefined;
  const username = typeof entry?.username === "string" && entry.username.trim() ? entry.username.trim() : undefined;
  const xp = Math.max(0, Math.round(Number(entry?.xp)));
  if (!Number.isFinite(rank) || !userId || !username || !Number.isFinite(xp)) return undefined;
  const avatarUrl =
    typeof entry?.avatarUrl === "string" && entry.avatarUrl.trim() ? entry.avatarUrl.trim() : undefined;
  const daysActive = Number.isFinite(Number(entry?.daysActive))
    ? Math.max(0, Math.round(Number(entry?.daysActive)))
    : undefined;
  return { rank, userId, username, avatarUrl, xp, daysActive };
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
