export interface Env {
  DB: D1Database;
  APP_ORIGIN?: string;
  PUBLIC_READ_RATE_LIMITER?: RateLimitBinding;
  AUTH_RATE_LIMITER?: RateLimitBinding;
  WRITE_RATE_LIMITER?: RateLimitBinding;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  SESSION_SECRET: string;
}

type LeaderboardRange = "today" | "7d" | "30d" | "all";
type UsagePreferencePeriod = "early" | "morning" | "afternoon" | "evening" | "night";
type RateLimitName = "PUBLIC_READ_RATE_LIMITER" | "AUTH_RATE_LIMITER" | "WRITE_RATE_LIMITER";
type SecurityEventType =
  | "rate_limited"
  | "invalid_callback"
  | "auth_failed"
  | "sync_cooldown"
  | "invalid_payload"
  | "server_error";

const MAX_DAILY_ACCEPTED_TOKENS = 1_000_000_000_000_000;
const MAX_BACKFILL_DAYS = 30;
const SYNC_COOLDOWN_SECONDS = 30 * 60;
const AUTH_CODE_TTL_MS = 5 * 60 * 1000;

interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface AuthState {
  callback: string;
  state: string;
  codeChallenge: string;
  exp: number;
}

interface GithubUser {
  id: number;
  login: string;
  avatar_url?: string;
  html_url?: string;
}

interface SessionUser {
  userId: string;
  username: string;
  avatarUrl?: string;
}

interface UsagePreferenceRow {
  range: LeaderboardRange;
  favoriteAgentLabel?: string;
  favoriteAgentPercent?: number;
  favoriteModel?: string;
  favoritePeriod?: UsagePreferencePeriod;
  favoritePeriodStart?: number;
  favoritePeriodEnd?: number;
  peakTokensPerMinute?: number;
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details: Record<string, unknown> = {},
    public logType?: SecurityEventType,
    public logDetails: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "HttpError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(env) });

    const url = new URL(request.url);
    try {
      await enforceRouteRateLimit(request, env, ctx);

      if (url.pathname === "/health") return json({ ok: true }, env);
      if (url.pathname === "/auth/github/start" && request.method === "GET") return await startGithubAuth(request, env);
      if (url.pathname === "/auth/github/callback" && request.method === "GET") return await finishGithubAuth(request, env);
      if (url.pathname === "/auth/session" && request.method === "POST") return await exchangeAuthSession(request, env);
      if (url.pathname === "/api/me" && request.method === "GET") return await getMe(request, env);
      if (url.pathname === "/api/me" && request.method === "DELETE") return await deleteMe(request, env);
      if (url.pathname === "/api/usage/daily" && request.method === "POST") return await syncDailyUsage(request, env);
      if (url.pathname === "/api/leaderboard" && request.method === "GET") return await getLeaderboard(request, env);
      return json({ error: "Not found" }, env, 404);
    } catch (error) {
      if (error instanceof HttpError) {
        if (shouldLogHttpError(error)) {
          ctx.waitUntil(logSecurityEvent(request, env, error.logType || statusLogType(error.status), {
            status: error.status,
            message: error.message,
            details: error.details,
            ...error.logDetails,
          }));
        }
        return json({ error: error.message, ...error.details }, env, error.status);
      }
      const message = error instanceof Error ? error.message : "Unknown error";
      ctx.waitUntil(logSecurityEvent(request, env, "server_error", { status: 500, message }));
      return json({ error: message }, env, 500);
    }
  },
};

function corsHeaders(env: Env) {
  return {
    "Access-Control-Allow-Origin": env.APP_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type",
  };
}

function json(body: unknown, env: Env, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...corsHeaders(env),
    },
  });
}

async function enforceRouteRateLimit(request: Request, env: Env, ctx: ExecutionContext) {
  const policy = rateLimitPolicy(request);
  if (!policy) return;

  const limiter = env[policy.name];
  if (!limiter) return;

  const key = `${policy.keyPrefix}:${clientIp(request)}`;
  const result = await limiter.limit({ key });
  if (result.success) return;

  ctx.waitUntil(logSecurityEvent(request, env, "rate_limited", {
    limiter: policy.name,
    keyPrefix: policy.keyPrefix,
    status: 429,
  }));
  throw new HttpError(429, "Too many requests. Please slow down and try again shortly.", {
    retryAfterSeconds: 60,
  }, "rate_limited");
}

function rateLimitPolicy(request: Request): { name: RateLimitName; keyPrefix: string } | undefined {
  const url = new URL(request.url);
  const route = `${request.method} ${url.pathname}`;

  if (route === "GET /api/leaderboard") {
    return { name: "PUBLIC_READ_RATE_LIMITER", keyPrefix: "leaderboard:read" };
  }
  if (route === "GET /auth/github/start" || route === "GET /auth/github/callback") {
    return { name: "AUTH_RATE_LIMITER", keyPrefix: `auth:${url.pathname}` };
  }
  if (route === "POST /auth/session") {
    return { name: "AUTH_RATE_LIMITER", keyPrefix: "auth:/auth/session" };
  }
  if (route === "GET /api/me" || route === "DELETE /api/me" || route === "POST /api/usage/daily") {
    return { name: "WRITE_RATE_LIMITER", keyPrefix: `api:${url.pathname}` };
  }

  return undefined;
}

function clientIp(request: Request) {
  const forwarded = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "";
  return forwarded.split(",")[0]?.trim() || "unknown";
}

function shouldLogHttpError(error: HttpError) {
  if (error.logType === "rate_limited") return false;
  return Boolean(error.logType) || error.status === 401 || error.status === 429 || error.status >= 500;
}

function statusLogType(status: number): SecurityEventType {
  if (status === 401) return "auth_failed";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return "invalid_payload";
}

async function logSecurityEvent(
  request: Request,
  env: Env,
  type: SecurityEventType,
  metadata: Record<string, unknown> = {},
) {
  const url = new URL(request.url);
  const now = new Date().toISOString();
  const cf = (request as Request & { cf?: { country?: string } }).cf;
  const ipHash = await hashLogValue(clientIp(request), env);
  const userAgent = (request.headers.get("User-Agent") || "").slice(0, 180);
  const status = typeof metadata.status === "number" ? metadata.status : null;
  const actorId = typeof metadata.actorId === "string" ? metadata.actorId : null;
  const metadataJson = safeMetadataJson(metadata);

  const event = {
    event: "leaderboard_security",
    type,
    path: url.pathname,
    method: request.method,
    status,
    actorId,
    ipHash,
    country: cf?.country || null,
  };
  console.warn(JSON.stringify(event));

  if (type === "rate_limited") return;

  try {
    await env.DB.prepare(
      `INSERT INTO security_events
         (created_at, type, path, method, status, actor_id, ip_hash, country, user_agent, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        now,
        type,
        url.pathname,
        request.method,
        status,
        actorId,
        ipHash,
        cf?.country || null,
        userAgent || null,
        metadataJson,
      )
      .run();
  } catch (error) {
    console.warn(JSON.stringify({
      event: "leaderboard_security_log_failed",
      message: error instanceof Error ? error.message : "Unknown error",
    }));
  }
}

async function hashLogValue(value: string, env: Env) {
  if (!value || value === "unknown") return null;
  return hmac(value, env.SESSION_SECRET || "vibe-tree").then((hash) => hash.slice(0, 32));
}

function safeMetadataJson(metadata: Record<string, unknown>) {
  try {
    return JSON.stringify(metadata).slice(0, 2000);
  } catch {
    return "{}";
  }
}

async function startGithubAuth(request: Request, env: Env) {
  assertConfigured(env);
  const url = new URL(request.url);
  const callback = url.searchParams.get("callback") || "";
  const state = url.searchParams.get("state") || "";
  const codeChallenge = url.searchParams.get("code_challenge") || "";
  if (!isLocalCallback(callback) || !state || !isPkceValue(codeChallenge)) {
    throw new HttpError(400, "Invalid callback", {}, "invalid_callback");
  }

  const redirectUri = new URL("/auth/github/callback", url.origin).toString();
  const signedState = await signState({ callback, state, codeChallenge, exp: Date.now() + 10 * 60 * 1000 }, env);
  const github = new URL("https://github.com/login/oauth/authorize");
  github.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  github.searchParams.set("redirect_uri", redirectUri);
  github.searchParams.set("scope", "read:user");
  github.searchParams.set("state", signedState);
  return Response.redirect(github.toString(), 302);
}

async function finishGithubAuth(request: Request, env: Env) {
  assertConfigured(env);
  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "";
  const signedState = url.searchParams.get("state") || "";
  const state = await verifyState(signedState, env);
  if (!code || !state) return redirectBack(state?.callback, state?.state, undefined, "GitHub login failed");
  if (state.exp < Date.now()) return redirectBack(state.callback, state.state, undefined, "GitHub login expired");

  const redirectUri = new URL("/auth/github/callback", url.origin).toString();
  const accessToken = await exchangeGithubCode(code, redirectUri, env);
  const githubUser = await fetchGithubUser(accessToken);
  const profile = {
    id: String(githubUser.id),
    username: githubUser.login,
    avatarUrl: githubUser.avatar_url || undefined,
  };
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO users (user_id, username, avatar_url, profile_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       username = excluded.username,
       avatar_url = excluded.avatar_url,
       profile_url = excluded.profile_url,
       updated_at = excluded.updated_at`,
  )
    .bind(profile.id, profile.username, profile.avatarUrl || null, githubUser.html_url || null, now, now)
    .run();

  const sessionCode = randomToken();
  const codeHash = await hashToken(sessionCode);
  const expiresAt = new Date(Date.now() + AUTH_CODE_TTL_MS).toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM auth_codes WHERE expires_at <= ?").bind(now),
    env.DB.prepare(
      "INSERT INTO auth_codes (code_hash, user_id, code_challenge, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(codeHash, profile.id, state.codeChallenge, now, expiresAt),
  ]);

  return redirectBack(state.callback, state.state, sessionCode);
}

async function exchangeAuthSession(request: Request, env: Env) {
  assertConfigured(env);
  const body = await request.json().catch(() => undefined) as { code?: string; codeVerifier?: string } | undefined;
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  const codeVerifier = typeof body?.codeVerifier === "string" ? body.codeVerifier.trim() : "";
  if (!isPkceValue(code) || !isPkceValue(codeVerifier)) {
    throw new HttpError(400, "Invalid auth code", {}, "invalid_payload");
  }

  const now = new Date().toISOString();
  const codeHash = await hashToken(code);
  const codeChallenge = await codeChallengeForVerifier(codeVerifier);
  const consumed = await env.DB.prepare(
    `DELETE FROM auth_codes
     WHERE code_hash = ? AND code_challenge = ? AND expires_at > ?
     RETURNING user_id AS userId`,
  )
    .bind(codeHash, codeChallenge, now)
    .first<{ userId?: string }>();
  if (!consumed?.userId) {
    throw new HttpError(401, "Auth code expired or invalid", {}, "auth_failed");
  }

  const user = await env.DB.prepare(
    "SELECT user_id AS userId, username, avatar_url AS avatarUrl FROM users WHERE user_id = ?",
  )
    .bind(consumed.userId)
    .first<Record<string, unknown>>();
  if (!user) throw new HttpError(401, "Auth code user not found", {}, "auth_failed");

  const token = randomToken();
  const tokenHash = await hashToken(token);
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(
    "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
  )
    .bind(tokenHash, String(user.userId), now, expiresAt)
    .run();

  return json({
    token,
    profile: toProfile({
      userId: String(user.userId),
      username: String(user.username),
      avatarUrl: typeof user.avatarUrl === "string" ? user.avatarUrl : undefined,
    }),
  }, env);
}

async function getMe(request: Request, env: Env) {
  const user = await requireAuth(request, env);
  return json({ profile: toProfile(user) }, env);
}

async function deleteMe(request: Request, env: Env) {
  const user = await requireAuth(request, env);
  await ensureUsagePreferencesTable(env);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM daily_usage WHERE user_id = ?").bind(user.userId),
    env.DB.prepare("DELETE FROM usage_preferences WHERE user_id = ?").bind(user.userId),
    env.DB.prepare("DELETE FROM sync_limits WHERE user_id = ?").bind(user.userId),
    env.DB.prepare("DELETE FROM auth_codes WHERE user_id = ?").bind(user.userId),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.userId),
    env.DB.prepare("DELETE FROM security_events WHERE actor_id = ?").bind(user.userId),
    env.DB.prepare("DELETE FROM users WHERE user_id = ?").bind(user.userId),
  ]);
  return json({ ok: true }, env);
}

async function syncDailyUsage(request: Request, env: Env) {
  const user = await requireAuth(request, env);

  const body = await request.json().catch(() => undefined) as
    | {
        days?: Array<{ date?: string; tokens?: number; xp?: number }>;
        appVersion?: string;
        usageStartDate?: string;
        forceSync?: boolean;
        usagePreferencesPublic?: boolean;
        usagePreferences?: unknown[];
      }
    | undefined;
  if (body?.forceSync !== true) await enforceSyncCooldown(user.userId, env);
  const days = Array.isArray(body?.days) ? body.days.slice(0, MAX_BACKFILL_DAYS) : [];
  const appVersion = typeof body?.appVersion === "string" ? body.appVersion.slice(0, 32) : null;
  const usageStartDate = normalizeUsageStartDate(body?.usageStartDate);
  const usagePreferencesPublic = body?.usagePreferencesPublic === true;
  const usagePreferenceInput = Array.isArray(body?.usagePreferences) ? body.usagePreferences : [];
  const now = new Date().toISOString();
  const syncWindow = dailySyncWindow(usageStartDate);
  const normalizedDays = normalizeDailyUsageRows(days, syncWindow);
  const preferenceRows = usagePreferencesPublic ? normalizeUsagePreferenceRows(usagePreferenceInput) : [];
  const statements = normalizedDays.map((day) =>
    env.DB.prepare(
      `INSERT INTO daily_usage (user_id, date, xp, app_version, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, date) DO UPDATE SET
         xp = excluded.xp,
         app_version = excluded.app_version,
         updated_at = excluded.updated_at`,
    ).bind(user.userId, day.date, day.xp, appVersion, now),
  );
  const preferenceStatements = preferenceRows.map((preference) =>
    env.DB.prepare(
      `INSERT INTO usage_preferences (
         user_id, range, favorite_agent_label, favorite_agent_percent, favorite_model,
         favorite_period, favorite_period_start, favorite_period_end, peak_tokens_per_minute, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, range) DO UPDATE SET
         favorite_agent_label = excluded.favorite_agent_label,
         favorite_agent_percent = excluded.favorite_agent_percent,
         favorite_model = excluded.favorite_model,
         favorite_period = excluded.favorite_period,
         favorite_period_start = excluded.favorite_period_start,
         favorite_period_end = excluded.favorite_period_end,
         peak_tokens_per_minute = excluded.peak_tokens_per_minute,
         updated_at = excluded.updated_at`,
    ).bind(
      user.userId,
      preference.range,
      preference.favoriteAgentLabel ?? null,
      preference.favoriteAgentPercent ?? null,
      preference.favoriteModel ?? null,
      preference.favoritePeriod ?? null,
      preference.favoritePeriodStart ?? null,
      preference.favoritePeriodEnd ?? null,
      preference.peakTokensPerMinute ?? null,
      now,
    ),
  );

  await ensureUsagePreferencesTable(env);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM daily_usage WHERE user_id = ? AND date >= ? AND date <= ?")
      .bind(user.userId, syncWindow.earliest, syncWindow.latest),
    ...(usageStartDate
      ? [env.DB.prepare("DELETE FROM daily_usage WHERE user_id = ? AND date < ?").bind(user.userId, usageStartDate)]
      : []),
    env.DB.prepare("DELETE FROM usage_preferences WHERE user_id = ?").bind(user.userId),
    ...statements,
    ...preferenceStatements,
    env.DB.prepare(
      `INSERT INTO sync_limits (user_id, last_synced_at)
       VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET last_synced_at = excluded.last_synced_at`,
    ).bind(user.userId, now),
  ]);
  return json(
    {
      ok: true,
      synced: statements.length,
      syncedPreferences: preferenceStatements.length,
      leaderboardType: "community",
      usageStartDate,
      safetyMaxDailyTokens: MAX_DAILY_ACCEPTED_TOKENS,
      nextSyncAfterSeconds: SYNC_COOLDOWN_SECONDS,
    },
    env,
  );
}

async function enforceSyncCooldown(userId: string, env: Env) {
  const row = await env.DB.prepare("SELECT last_synced_at AS lastSyncedAt FROM sync_limits WHERE user_id = ?")
    .bind(userId)
    .first<{ lastSyncedAt?: string }>();
  if (!row?.lastSyncedAt) return;

  const elapsedSeconds = Math.floor((Date.now() - Date.parse(row.lastSyncedAt)) / 1000);
  const retryAfterSeconds = SYNC_COOLDOWN_SECONDS - elapsedSeconds;
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    throw new HttpError(429, `Sync is limited to once every 30 minutes. Try again in ${Math.ceil(retryAfterSeconds / 60)} minutes.`, {
      retryAfterSeconds,
    }, "sync_cooldown", { actorId: userId });
  }
}

async function ensureUsagePreferencesTable(env: Env) {
  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS usage_preferences (
        user_id TEXT NOT NULL,
        range TEXT NOT NULL,
        favorite_agent_label TEXT,
        favorite_agent_percent INTEGER,
        favorite_model TEXT,
        favorite_period TEXT,
        favorite_period_start INTEGER,
        favorite_period_end INTEGER,
        peak_tokens_per_minute INTEGER,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, range),
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      )`,
    ),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_usage_preferences_user ON usage_preferences(user_id)"),
  ]);
}

function normalizeDailyUsageRows(
  days: Array<{ date?: string; tokens?: number; xp?: number }>,
  window: { earliest: string; latest: string },
) {
  const byDate = new Map<string, number>();

  for (const day of days) {
    const date = typeof day.date === "string" && isDateKey(day.date) ? day.date : "";
    if (!date || date < window.earliest || date > window.latest) continue;

    const rawTokens = Math.round(Number(day.tokens ?? day.xp));
    if (!Number.isFinite(rawTokens) || rawTokens < 0) {
      throw new HttpError(400, "Tokens must be a non-negative integer.", {}, "invalid_payload");
    }
    if (rawTokens > MAX_DAILY_ACCEPTED_TOKENS) {
      throw new HttpError(400, `Daily tokens are above the accepted safety limit of ${MAX_DAILY_ACCEPTED_TOKENS}.`, {
        safetyMaxDailyTokens: MAX_DAILY_ACCEPTED_TOKENS,
      }, "invalid_payload");
    }

    byDate.set(date, Math.max(byDate.get(date) ?? 0, rawTokens));
  }

  return [...byDate.entries()].map(([date, tokens]) => ({
    date,
    tokens,
    xp: tokens,
  }));
}

function normalizeUsagePreferenceRows(rawRows: unknown[]) {
  const rows = new Map<LeaderboardRange, UsagePreferenceRow>();
  for (const raw of rawRows.slice(0, 4)) {
    const input = raw as Record<string, unknown> | undefined;
    if (!input || typeof input !== "object") continue;
    const range = normalizePreferenceRange(input.range);
    if (!range) continue;

    const favoriteAgent = input.favoriteAgent as Record<string, unknown> | undefined;
    const favoritePeriod = input.favoritePeriod as Record<string, unknown> | undefined;
    const row: UsagePreferenceRow = {
      range,
      favoriteAgentLabel: cleanShortText(favoriteAgent?.label, 64),
      favoriteAgentPercent: normalizePercent(favoriteAgent?.percent),
      favoriteModel: cleanShortText(input.favoriteModel, 64),
      favoritePeriod: normalizePreferencePeriod(favoritePeriod?.id),
      favoritePeriodStart: normalizeHour(favoritePeriod?.startHour, 0, 23),
      favoritePeriodEnd: normalizeHour(favoritePeriod?.endHour, 1, 24),
      peakTokensPerMinute: normalizePreferenceCount(input.peakTokensPerMinute),
    };

    if (
      !row.favoriteAgentLabel &&
      !row.favoriteModel &&
      !row.favoritePeriod &&
      row.peakTokensPerMinute === undefined
    ) {
      continue;
    }
    rows.set(range, row);
  }
  return [...rows.values()];
}

function dailySyncWindow(usageStartDate: string | undefined) {
  const today = localDateKey(new Date());
  const earliest = addDays(today, -(MAX_BACKFILL_DAYS - 1));
  const latest = addDays(today, 1);
  return {
    earliest: usageStartDate ? maxDateKey(earliest, usageStartDate) : earliest,
    latest,
  };
}

async function getLeaderboard(request: Request, env: Env) {
  await ensureUsagePreferencesTable(env);
  const url = new URL(request.url);
  const range = normalizeRange(url.searchParams.get("range"));
  const today = localDateKey(new Date());
  const since = rangeStart(range, today);
  const requestUser = await optionalAuth(request, env);
  const query =
    range === "all"
      ? `SELECT u.user_id AS userId, u.username AS username, u.avatar_url AS avatarUrl,
           SUM(d.xp) AS tokens,
           (SELECT COUNT(*) FROM daily_usage all_days WHERE all_days.user_id = u.user_id AND all_days.xp > 0) AS daysActive,
           p.favorite_agent_label AS favoriteAgentLabel,
           p.favorite_agent_percent AS favoriteAgentPercent,
           p.favorite_model AS favoriteModel,
           p.favorite_period AS favoritePeriod,
           p.favorite_period_start AS favoritePeriodStart,
           p.favorite_period_end AS favoritePeriodEnd,
           p.peak_tokens_per_minute AS peakTokensPerMinute,
           p.updated_at AS preferenceUpdatedAt
         FROM daily_usage d
         JOIN users u ON u.user_id = d.user_id
         LEFT JOIN usage_preferences p ON p.user_id = u.user_id AND p.range = ?
         GROUP BY u.user_id
         HAVING tokens > 0
         ORDER BY tokens DESC
         LIMIT 100`
      : `SELECT u.user_id AS userId, u.username AS username, u.avatar_url AS avatarUrl,
           SUM(d.xp) AS tokens,
           (SELECT COUNT(*) FROM daily_usage all_days WHERE all_days.user_id = u.user_id AND all_days.xp > 0) AS daysActive,
           p.favorite_agent_label AS favoriteAgentLabel,
           p.favorite_agent_percent AS favoriteAgentPercent,
           p.favorite_model AS favoriteModel,
           p.favorite_period AS favoritePeriod,
           p.favorite_period_start AS favoritePeriodStart,
           p.favorite_period_end AS favoritePeriodEnd,
           p.peak_tokens_per_minute AS peakTokensPerMinute,
           p.updated_at AS preferenceUpdatedAt
         FROM daily_usage d
         JOIN users u ON u.user_id = d.user_id
         LEFT JOIN usage_preferences p ON p.user_id = u.user_id AND p.range = ?
         WHERE d.date >= ?
         GROUP BY u.user_id
         HAVING tokens > 0
         ORDER BY tokens DESC
         LIMIT 100`;
  const result =
    range === "all" ? await env.DB.prepare(query).bind(range).all() : await env.DB.prepare(query).bind(range, since).all();
  const entries = (result.results || []).map((row, index) => ({
    rank: index + 1,
    userId: String(row.userId),
    username: String(row.username),
    avatarUrl: typeof row.avatarUrl === "string" ? row.avatarUrl : undefined,
    tokens: Math.max(0, Math.round(Number(row.tokens))),
    xp: Math.max(0, Math.round(Number(row.tokens))),
    daysActive: Math.max(0, Math.round(Number(row.daysActive))),
    usagePreference: rowToUsagePreference(row),
  }));
  return json(
    {
      range,
      entries,
      updatedAt: new Date().toISOString(),
      me: requestUser ? entries.find((entry) => entry.userId === requestUser.userId) : undefined,
    },
    env,
  );
}

function rowToUsagePreference(row: Record<string, unknown>) {
  const favoriteAgentLabel = typeof row.favoriteAgentLabel === "string" ? row.favoriteAgentLabel : undefined;
  const favoriteAgentPercent = normalizePercent(row.favoriteAgentPercent);
  const favoriteModel = typeof row.favoriteModel === "string" ? row.favoriteModel : undefined;
  const favoritePeriod = normalizePreferencePeriod(row.favoritePeriod);
  const favoritePeriodStart = normalizeHour(row.favoritePeriodStart, 0, 23);
  const favoritePeriodEnd = normalizeHour(row.favoritePeriodEnd, 1, 24);
  const peakTokensPerMinute = normalizePreferenceCount(row.peakTokensPerMinute);
  const updatedAt =
    typeof row.preferenceUpdatedAt === "string" && Number.isFinite(Date.parse(row.preferenceUpdatedAt))
      ? row.preferenceUpdatedAt
      : undefined;
  const usagePreference = {
    favoriteAgent:
      favoriteAgentLabel && favoriteAgentPercent !== undefined
        ? { label: favoriteAgentLabel, percent: favoriteAgentPercent }
        : undefined,
    favoriteModel,
    favoritePeriod:
      favoritePeriod && favoritePeriodStart !== undefined && favoritePeriodEnd !== undefined
        ? { id: favoritePeriod, startHour: favoritePeriodStart, endHour: favoritePeriodEnd }
        : undefined,
    peakTokensPerMinute,
    updatedAt,
  };
  return usagePreference.favoriteAgent ||
    usagePreference.favoriteModel ||
    usagePreference.favoritePeriod ||
    usagePreference.peakTokensPerMinute !== undefined
    ? usagePreference
    : undefined;
}

async function requireAuth(request: Request, env: Env) {
  const user = await optionalAuth(request, env);
  if (!user) throw new HttpError(401, "Unauthorized");
  return user;
}

async function optionalAuth(request: Request, env: Env): Promise<SessionUser | undefined> {
  const token = authToken(request);
  if (!token) return undefined;
  const tokenHash = await hashToken(token);
  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    `SELECT u.user_id AS userId, u.username AS username, u.avatar_url AS avatarUrl
     FROM sessions s
     JOIN users u ON u.user_id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(tokenHash, now)
    .first<Record<string, unknown>>();
  if (!row) return undefined;
  return {
    userId: String(row.userId),
    username: String(row.username),
    avatarUrl: typeof row.avatarUrl === "string" ? row.avatarUrl : undefined,
  };
}

function authToken(request: Request) {
  const header = request.headers.get("Authorization") || "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : undefined;
}

function toProfile(user: SessionUser) {
  return {
    id: user.userId,
    username: user.username,
    avatarUrl: user.avatarUrl,
  };
}

function assertConfigured(env: Env) {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || !env.SESSION_SECRET) {
    throw new Error("GitHub OAuth is not configured");
  }
}

async function exchangeGithubCode(code: string, redirectUri: string, env: Env) {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "Vibe Tree Leaderboard",
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const data = await response.json() as { access_token?: string; error_description?: string };
  if (!response.ok || !data.access_token) throw new Error(data.error_description || "GitHub token exchange failed");
  return data.access_token;
}

async function fetchGithubUser(accessToken: string): Promise<GithubUser> {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "Vibe Tree Leaderboard",
    },
  });
  if (!response.ok) throw new Error("GitHub user request failed");
  const user = await response.json() as GithubUser;
  if (!user.id || !user.login) throw new Error("GitHub user response is invalid");
  return user;
}

async function signState(state: AuthState, env: Env) {
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(state)));
  const signature = await hmac(payload, env.SESSION_SECRET);
  return `${payload}.${signature}`;
}

async function verifyState(value: string, env: Env): Promise<AuthState | undefined> {
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return undefined;
  const expected = await hmac(payload, env.SESSION_SECRET);
  if (signature !== expected) return undefined;
  const raw = base64UrlDecode(payload);
  return JSON.parse(new TextDecoder().decode(raw)) as AuthState;
}

async function hmac(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64UrlEncode(new Uint8Array(signature));
}

async function codeChallengeForVerifier(verifier: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

function base64UrlEncode(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function redirectBack(callback: string | undefined, state: string | undefined, code?: string, error?: string) {
  if (!callback) return new Response(error || "Login failed", { status: 400 });
  const url = new URL(callback);
  if (code) url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);
  if (error) url.searchParams.set("error", error);
  return Response.redirect(url.toString(), 302);
}

function isLocalCallback(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  } catch {
    return false;
  }
}

function isPkceValue(value: string) {
  return /^[A-Za-z0-9_-]{43,128}$/.test(value);
}

function isDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return localDateKey(new Date(`${value}T00:00:00Z`)) === value;
}

function normalizeRange(value: string | null): LeaderboardRange {
  return value === "today" || value === "30d" || value === "all" ? value : "7d";
}

function normalizePreferenceRange(value: unknown): LeaderboardRange | undefined {
  return value === "today" || value === "7d" || value === "30d" || value === "all" ? value : undefined;
}

function normalizePreferencePeriod(value: unknown): UsagePreferencePeriod | undefined {
  return value === "early" || value === "morning" || value === "afternoon" || value === "evening" || value === "night"
    ? value
    : undefined;
}

function cleanShortText(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : undefined;
}

function normalizePercent(value: unknown) {
  const percent = Math.round(Number(value));
  return Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : undefined;
}

function normalizeHour(value: unknown, min: number, max: number) {
  const hour = Math.round(Number(value));
  return Number.isFinite(hour) ? Math.max(min, Math.min(max, hour)) : undefined;
}

function normalizePreferenceCount(value: unknown) {
  const count = Math.round(Number(value));
  return Number.isFinite(count) ? Math.max(0, Math.min(MAX_DAILY_ACCEPTED_TOKENS, count)) : undefined;
}

function rangeStart(range: LeaderboardRange, today: string) {
  if (range === "today") return today;
  if (range === "30d") return addDays(today, -29);
  if (range === "7d") return addDays(today, -6);
  return "0000-01-01";
}

function normalizeUsageStartDate(value: unknown) {
  if (typeof value !== "string" || !isDateKey(value)) return undefined;
  const latest = addDays(localDateKey(new Date()), 1);
  return value <= latest ? value : undefined;
}

function maxDateKey(left: string, right: string) {
  return left > right ? left : right;
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return localDateKey(date);
}

function localDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}
