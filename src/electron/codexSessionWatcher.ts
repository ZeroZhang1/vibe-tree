import { createHash } from "node:crypto";
import {
  existsSync,
  closeSync,
  mkdirSync,
  openSync,
  readSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import { dirname, join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { UsageEvent, UsageStatus } from "../shared/types.js";

interface CodexSessionWatcherOptions {
  userDataPath: string;
  onUsage: (event: UsageEvent) => void;
  onStatus?: (status: UsageStatus["codexSession"]) => void;
}

interface WatchState {
  files: Record<string, number>;
  cumulativeTokens: Record<string, CumulativeUsage | number>;
}

interface TokenUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

interface CumulativeUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

interface ParsedTokenEvent extends UsageEvent {
  cumulativeKey: string;
  cumulativeUsage?: CumulativeUsage;
  deltaUsage?: CumulativeUsage;
}

const POLL_INTERVAL_MS = 10_000;
const READ_CHUNK_SIZE = 64 * 1024;
const DEFAULT_SESSIONS_ROOT = join(process.env.USERPROFILE || "", ".codex", "sessions");

export function startCodexSessionWatcher(options: CodexSessionWatcherOptions) {
  const sessionsRoot = process.env.VIBE_CODEX_SESSIONS_DIR || DEFAULT_SESSIONS_ROOT;
  const importHistory = process.env.VIBE_CODEX_IMPORT_HISTORY === "today";
  const statePath = join(options.userDataPath, "codex-session-watcher.json");
  const state = readState(statePath);
  const watcherStartedAt = Date.now();
  const status: UsageStatus["codexSession"] = {
    running: true,
    sessionsRoot,
    exists: existsSync(sessionsRoot),
    filesWatched: 0,
    eventsImported: 0,
    importHistory,
  };

  let closed = false;

  const poll = () => {
    if (closed) return;
    status.exists = existsSync(sessionsRoot);
    status.lastScanAt = new Date().toISOString();
    if (!status.exists) {
      options.onStatus?.(status);
      return;
    }
    const files = listJsonlFiles(sessionsRoot);
    status.filesWatched = files.length;
    for (const filePath of files) {
      const imported = scanFile(filePath, state, statePath, options, {
        importHistory,
        watcherStartedAt,
      });
      if (imported > 0) {
        status.eventsImported += imported;
        status.lastEventAt = new Date().toISOString();
      }
    }
    options.onStatus?.(status);
  };

  poll();
  const timer = setInterval(poll, POLL_INTERVAL_MS);

  return {
    close: () => {
      closed = true;
      status.running = false;
      clearInterval(timer);
      writeState(statePath, state);
      options.onStatus?.(status);
    },
    getStatus: () => status,
  };
}

function scanFile(
  filePath: string,
  state: WatchState,
  statePath: string,
  options: CodexSessionWatcherOptions,
  settings: { importHistory: boolean; watcherStartedAt: number },
): number {
  let imported = 0;
  const stats = statSync(filePath);
  const previousOffset = state.files[filePath];
  const offset =
    previousOffset ??
    initialOffset(filePath, stats, {
      importHistory: settings.importHistory,
      watcherStartedAt: settings.watcherStartedAt,
    });

  if (stats.size <= offset) {
    state.files[filePath] = stats.size;
    return imported;
  }

  imported += scanNewLines(filePath, offset, stats.size, (line, lineOffset) => {
    const event = parseCodexTokenCountLine(line, filePath, lineOffset);
    if (event) {
      const previousTotal = normalizeStoredUsage(state.cumulativeTokens[event.cumulativeKey]);
      const deltaUsage =
        event.cumulativeUsage && previousTotal ? subtractUsage(event.cumulativeUsage, previousTotal) : event.deltaUsage;
      if (event.cumulativeUsage) {
        state.cumulativeTokens[event.cumulativeKey] = maxUsage(event.cumulativeUsage, previousTotal);
      }
      if (!deltaUsage) return 0;
      const totalTokens = usageTotal(deltaUsage);
      if (totalTokens <= 0) return 0;
      options.onUsage({
        ...event,
        inputTokens: deltaUsage.inputTokens,
        outputTokens: deltaUsage.outputTokens,
        cacheReadTokens: deltaUsage.cacheReadTokens,
        totalTokens,
      });
      return 1;
    }
    return 0;
  });

  state.files[filePath] = stats.size;
  writeState(statePath, state);
  return imported;
}

function scanNewLines(filePath: string, start: number, end: number, onLine: (line: string, lineOffset: number) => number) {
  const fd = openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(READ_CHUNK_SIZE);
  const decoder = new StringDecoder("utf8");
  let position = start;
  let pending = "";
  let pendingOffset = start;
  let imported = 0;

  try {
    while (position < end) {
      const bytesToRead = Math.min(READ_CHUNK_SIZE, end - position);
      const bytesRead = readSync(fd, buffer, 0, bytesToRead, position);
      if (bytesRead <= 0) break;
      position += bytesRead;
      pending += decoder.write(buffer.subarray(0, bytesRead));

      let newlineIndex = pending.indexOf("\n");
      while (newlineIndex >= 0) {
        const rawLine = pending.slice(0, newlineIndex);
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
        if (line.trim()) {
          imported += onLine(line, pendingOffset);
        }
        pendingOffset += Buffer.byteLength(`${rawLine}\n`, "utf8");
        pending = pending.slice(newlineIndex + 1);
        newlineIndex = pending.indexOf("\n");
      }
    }

    pending += decoder.end();
    if (pending.trim()) {
      imported += onLine(pending, pendingOffset);
    }
  } finally {
    closeSync(fd);
  }

  return imported;
}

function initialOffset(filePath: string, stats: Stats, settings: { importHistory: boolean; watcherStartedAt: number }) {
  if (settings.importHistory && isTodaySessionPath(filePath)) {
    return 0;
  }
  if (stats.mtimeMs >= settings.watcherStartedAt - 5_000) {
    return 0;
  }
  return stats.size;
}

function parseCodexTokenCountLine(line: string, filePath: string, lineOffset: number): ParsedTokenEvent | undefined {
  const parsed = parseJson(line);
  if (!parsed || parsed.type !== "event_msg") return undefined;

  const payload = asRecord(parsed.payload);
  if (payload?.type !== "token_count") return undefined;

  const rateLimits = asRecord(payload.rate_limits);
  const limitId = typeof rateLimits?.limit_id === "string" ? rateLimits.limit_id : "";
  const limitName = typeof rateLimits?.limit_name === "string" ? rateLimits.limit_name : undefined;

  // Codex currently writes a generic aggregate and a model-specific row for the
  // same turn. Keep the model-specific row to avoid double counting.
  if (limitId === "codex" && !limitName) return undefined;

  const info = asRecord(payload.info);
  const usage = parseUsage(asRecord(info?.last_token_usage) as TokenUsage | undefined);
  const totalUsage = parseUsage(asRecord(info?.total_token_usage) as TokenUsage | undefined);
  if (!usage && !totalUsage) return undefined;

  const createdAt = typeof parsed.timestamp === "string" ? parsed.timestamp : new Date().toISOString();
  const model = limitName || limitId || undefined;
  const cumulativeKey = `${filePath}:${model ?? "unknown"}`;
  const hashBasis = `${filePath}:${lineOffset}:${model}:${usage ? usageTotal(usage) : 0}:${
    totalUsage ? usageTotal(totalUsage) : 0
  }`;

  return {
    id: `codex-session:${hash(hashBasis)}`,
    createdAt,
    source: "codex-session",
    agent: "codex-desktop",
    provider: "chatgpt-login",
    model,
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    cacheReadTokens: usage?.cacheReadTokens ?? 0,
    cacheWriteTokens: 0,
    totalTokens: usage ? usageTotal(usage) : 0,
    streaming: false,
    cumulativeKey,
    cumulativeUsage: totalUsage,
    deltaUsage: usage,
  };
}

function parseUsage(usage: TokenUsage | undefined): CumulativeUsage | undefined {
  if (!usage) return undefined;
  const inputTokens = numberValue(usage.input_tokens);
  const outputTokens = numberValue(usage.output_tokens);
  const cacheReadTokens = Math.min(
    inputTokens,
    numberValue(usage.cached_input_tokens) || numberValue(usage.cache_read_input_tokens),
  );
  const totalTokens = numberValue(usage.total_tokens) || inputTokens + outputTokens;
  if (totalTokens <= 0 && cacheReadTokens <= 0) return undefined;
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
  };
}

function usageTotal(usage: CumulativeUsage) {
  return usage.inputTokens + usage.outputTokens;
}

function subtractUsage(current: CumulativeUsage, previous: CumulativeUsage): CumulativeUsage {
  return {
    inputTokens: Math.max(0, current.inputTokens - previous.inputTokens),
    outputTokens: Math.max(0, current.outputTokens - previous.outputTokens),
    cacheReadTokens: Math.max(0, current.cacheReadTokens - previous.cacheReadTokens),
  };
}

function maxUsage(current: CumulativeUsage, previous: CumulativeUsage | undefined): CumulativeUsage {
  if (!previous) return current;
  return {
    inputTokens: Math.max(current.inputTokens, previous.inputTokens),
    outputTokens: Math.max(current.outputTokens, previous.outputTokens),
    cacheReadTokens: Math.max(current.cacheReadTokens, previous.cacheReadTokens),
  };
}

function normalizeStoredUsage(value: CumulativeUsage | number | undefined): CumulativeUsage | undefined {
  if (typeof value === "number") {
    return { inputTokens: value, outputTokens: 0, cacheReadTokens: 0 };
  }
  if (!value || typeof value !== "object") return undefined;
  return {
    inputTokens: numberValue(value.inputTokens),
    outputTokens: numberValue(value.outputTokens),
    cacheReadTokens: numberValue(value.cacheReadTokens),
  };
}

function listJsonlFiles(root: string) {
  const result: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        result.push(fullPath);
      }
    }
  };
  visit(root);
  return result;
}

function readState(path: string): WatchState {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<WatchState>;
    return {
      files: parsed.files && typeof parsed.files === "object" ? parsed.files : {},
      cumulativeTokens:
        parsed.cumulativeTokens && typeof parsed.cumulativeTokens === "object" ? parsed.cumulativeTokens : {},
    };
  } catch {
    return { files: {}, cumulativeTokens: {} };
  }
}

function writeState(path: string, state: WatchState) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2), "utf8");
}

function parseJson(value: string) {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function isTodaySessionPath(filePath: string) {
  const now = new Date();
  const parts = filePath.split(/[\\/]+/);
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  for (let index = 0; index < parts.length - 2; index += 1) {
    if (parts[index] === year && parts[index + 1] === month && parts[index + 2] === day) {
      return true;
    }
  }
  return false;
}
