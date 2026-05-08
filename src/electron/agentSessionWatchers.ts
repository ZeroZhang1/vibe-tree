import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  renameSync,
  statSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { SessionMonitorStatus, UsageEvent } from "../shared/types.js";

interface SessionWatcherOptions {
  userDataPath: string;
  sessionsRoot?: string;
  historyStartAt?: string;
  onUsage: (event: UsageEvent) => void;
  onStatus?: (status: SessionMonitorStatus) => void;
}

interface WatchState {
  files: Record<string, number>;
  historyStartAt?: string;
}

interface AgentConfig {
  source: "claude-session" | "openclaw-session";
  agent: "claude-code" | "openclaw";
  sessionsRoot: string;
  importHistoryEnv: string;
  stateFileName: string;
  pollIntervalMs: number;
  parseLine: (line: string, filePath: string, lineOffset: number) => UsageEvent | undefined;
}

interface JsonAgentConfig {
  source: "opencode-session";
  agent: "opencode";
  sessionsRoot: string;
  importHistoryEnv: string;
  stateFileName: string;
  pollIntervalMs: number;
  parseFile: (filePath: string) => UsageEvent | undefined;
}

const READ_CHUNK_SIZE = 64 * 1024;
const DEFAULT_CLAUDE_ROOT = join(homedir(), ".claude", "projects");
const DEFAULT_OPENCLAW_ROOT = join(homedir(), ".openclaw", "agents");
const DEFAULT_OPENCODE_MESSAGES_ROOT = defaultOpenCodeMessagesRoot();

export function startClaudeSessionWatcher(options: SessionWatcherOptions) {
  return startAgentSessionWatcher(options, {
    source: "claude-session",
    agent: "claude-code",
    sessionsRoot: options.sessionsRoot || process.env.VIBE_CLAUDE_SESSIONS_DIR || DEFAULT_CLAUDE_ROOT,
    importHistoryEnv: "VIBE_CLAUDE_IMPORT_HISTORY",
    stateFileName: "claude-session-watcher.json",
    pollIntervalMs: 10_000,
    parseLine: parseClaudeLine,
  });
}

export function startOpenClawSessionWatcher(options: SessionWatcherOptions) {
  return startAgentSessionWatcher(options, {
    source: "openclaw-session",
    agent: "openclaw",
    sessionsRoot: options.sessionsRoot || process.env.VIBE_OPENCLAW_SESSIONS_DIR || DEFAULT_OPENCLAW_ROOT,
    importHistoryEnv: "VIBE_OPENCLAW_IMPORT_HISTORY",
    stateFileName: "openclaw-session-watcher.json",
    pollIntervalMs: 10_000,
    parseLine: parseOpenClawLine,
  });
}

export function startOpenCodeSessionWatcher(options: SessionWatcherOptions) {
  return startJsonAgentSessionWatcher(options, {
    source: "opencode-session",
    agent: "opencode",
    sessionsRoot: options.sessionsRoot || process.env.VIBE_OPENCODE_SESSIONS_DIR || DEFAULT_OPENCODE_MESSAGES_ROOT,
    importHistoryEnv: "VIBE_OPENCODE_IMPORT_HISTORY",
    stateFileName: "opencode-session-watcher.json",
    pollIntervalMs: 10_000,
    parseFile: parseOpenCodeFile,
  });
}

function startAgentSessionWatcher(options: SessionWatcherOptions, config: AgentConfig) {
  const historyStartAtMs = timestampMs(options.historyStartAt);
  const importHistory = process.env[config.importHistoryEnv] === "today" || Boolean(historyStartAtMs);
  const statePath = join(options.userDataPath, config.stateFileName);
  const state = readState(statePath);
  if (state.historyStartAt !== options.historyStartAt) {
    state.files = {};
    state.historyStartAt = options.historyStartAt;
  }
  const watcherStartedAt = Date.now();
  const status: SessionMonitorStatus = {
    running: true,
    sessionsRoot: config.sessionsRoot,
    exists: existsSync(config.sessionsRoot),
    filesWatched: 0,
    eventsImported: 0,
    importHistory,
    historyStartAt: options.historyStartAt,
  };

  let closed = false;

  const poll = () => {
    if (closed) return;
    status.exists = existsSync(config.sessionsRoot);
    status.lastScanAt = new Date().toISOString();
    if (!status.exists) {
      options.onStatus?.(status);
      return;
    }

    const files = listJsonlFiles(config.sessionsRoot);
    status.filesWatched = files.length;
    for (const filePath of files) {
      const imported = scanFile(
        filePath,
        state,
        statePath,
        config,
        { importHistory, watcherStartedAt, historyStartAtMs },
        options.onUsage,
      );
      if (imported > 0) {
        status.eventsImported += imported;
        status.lastEventAt = new Date().toISOString();
      }
    }
    options.onStatus?.(status);
  };

  poll();
  const timer = setInterval(poll, config.pollIntervalMs);

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

function startJsonAgentSessionWatcher(options: SessionWatcherOptions, config: JsonAgentConfig) {
  const historyStartAtMs = timestampMs(options.historyStartAt);
  const importHistory = process.env[config.importHistoryEnv] === "today" || Boolean(historyStartAtMs);
  const statePath = join(options.userDataPath, config.stateFileName);
  const state = readState(statePath);
  if (state.historyStartAt !== options.historyStartAt) {
    state.files = {};
    state.historyStartAt = options.historyStartAt;
  }
  const watcherStartedAt = Date.now();
  const status: SessionMonitorStatus = {
    running: true,
    sessionsRoot: config.sessionsRoot,
    exists: existsSync(config.sessionsRoot),
    filesWatched: 0,
    eventsImported: 0,
    importHistory,
    historyStartAt: options.historyStartAt,
  };

  let closed = false;

  const poll = () => {
    if (closed) return;
    status.exists = existsSync(config.sessionsRoot);
    status.lastScanAt = new Date().toISOString();
    if (!status.exists) {
      options.onStatus?.(status);
      return;
    }

    const files = listJsonFiles(config.sessionsRoot);
    status.filesWatched = files.length;
    for (const filePath of files) {
      const imported = scanJsonFile(
        filePath,
        state,
        statePath,
        config,
        { importHistory, watcherStartedAt, historyStartAtMs },
        options.onUsage,
      );
      if (imported > 0) {
        status.eventsImported += imported;
        status.lastEventAt = new Date().toISOString();
      }
    }
    options.onStatus?.(status);
  };

  poll();
  const timer = setInterval(poll, config.pollIntervalMs);

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
  config: AgentConfig,
  settings: { importHistory: boolean; watcherStartedAt: number; historyStartAtMs?: number },
  onUsage: (event: UsageEvent) => void,
) {
  let imported = 0;
  const stats = statSync(filePath);
  const previousOffset = state.files[filePath];
  const offset = previousOffset ?? initialOffset(filePath, stats, settings);

  if (stats.size <= offset) {
    state.files[filePath] = stats.size;
    return imported;
  }

  imported += scanNewLines(filePath, offset, stats.size, (line, lineOffset) => {
    const event = config.parseLine(line, filePath, lineOffset);
    if (!event || event.totalTokens <= 0) return 0;
    if (isBeforeHistoryStart(event.createdAt, settings.historyStartAtMs)) return 0;
    onUsage(event);
    return 1;
  });

  state.files[filePath] = stats.size;
  writeState(statePath, state);
  return imported;
}

function scanJsonFile(
  filePath: string,
  state: WatchState,
  statePath: string,
  config: JsonAgentConfig,
  settings: { importHistory: boolean; watcherStartedAt: number; historyStartAtMs?: number },
  onUsage: (event: UsageEvent) => void,
) {
  const stats = statSync(filePath);
  const previousMtime = state.files[filePath];
  if (previousMtime !== undefined && stats.mtimeMs <= previousMtime) {
    return 0;
  }

  if (previousMtime === undefined && shouldSkipInitialJsonFile(filePath, stats, settings)) {
    state.files[filePath] = stats.mtimeMs;
    writeState(statePath, state);
    return 0;
  }

  state.files[filePath] = stats.mtimeMs;
  writeState(statePath, state);

  const event = config.parseFile(filePath);
  if (!event || event.totalTokens <= 0) return 0;
  if (isBeforeHistoryStart(event.createdAt, settings.historyStartAtMs)) return 0;
  onUsage(event);
  return 1;
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

function parseClaudeLine(line: string, filePath: string, lineOffset: number): UsageEvent | undefined {
  const parsed = parseJson(line);
  if (!parsed || parsed.type !== "assistant") return undefined;

  const message = asRecord(parsed.message);
  if (!message) return undefined;
  if (!message.stop_reason) return undefined;

  const usage = asRecord(message.usage);
  const tokens = parseStandardUsage(usage);
  if (!tokens || tokens.outputTokens <= 0) return undefined;

  const messageId = stringValue(message.id) || hash(`${filePath}:${lineOffset}`);
  const model = stringValue(message.model);
  const agentId = stringValue(parsed.agentId);

  return {
    id: `claude-session:${messageId}`,
    createdAt: stringValue(parsed.timestamp) || new Date().toISOString(),
    source: "claude-session",
    agent: agentId ? `claude-code:${agentId}` : "claude-code",
    provider: "anthropic",
    model,
    inputTokens: tokens.inputTokens,
    outputTokens: tokens.outputTokens,
    cacheReadTokens: tokens.cacheReadTokens,
    cacheWriteTokens: tokens.cacheWriteTokens,
    totalTokens: tokens.inputTokens + tokens.outputTokens,
    streaming: true,
  };
}

function parseOpenClawLine(line: string, filePath: string, lineOffset: number): UsageEvent | undefined {
  const parsed = parseJson(line);
  if (!parsed || parsed.type !== "message") return undefined;

  const message = asRecord(parsed.message);
  if (!message || message.role !== "assistant") return undefined;

  const usage = asRecord(message.usage);
  const tokens = parseOpenClawUsage(usage);
  if (!tokens) return undefined;

  const messageId = stringValue(parsed.id) || stringValue(message.responseId) || hash(`${filePath}:${lineOffset}`);
  const provider = stringValue(message.provider) || "openclaw";
  const model = stringValue(message.model);

  return {
    id: `openclaw-session:${hash(`${filePath}:${messageId}`)}`,
    createdAt: stringValue(parsed.timestamp) || new Date().toISOString(),
    source: "openclaw-session",
    agent: "openclaw",
    provider,
    model,
    inputTokens: tokens.inputTokens,
    outputTokens: tokens.outputTokens,
    cacheReadTokens: tokens.cacheReadTokens,
    cacheWriteTokens: tokens.cacheWriteTokens,
    totalTokens: tokens.inputTokens + tokens.outputTokens,
    streaming: false,
  };
}

function parseOpenCodeFile(filePath: string): UsageEvent | undefined {
  const parsed = readJsonFile(filePath);
  if (!parsed || parsed.role !== "assistant") return undefined;

  const tokens = asRecord(parsed.tokens);
  if (!tokens) return undefined;

  const cache = asRecord(tokens.cache);
  const inputTokens = numberValue(tokens.input);
  const outputTokens = numberValue(tokens.output) + numberValue(tokens.reasoning);
  const cacheReadTokens = numberValue(cache?.read);
  const cacheWriteTokens = numberValue(cache?.write);
  const totalTokens = inputTokens + outputTokens;
  if (totalTokens <= 0) return undefined;

  const messageId = stringValue(parsed.id) || hash(filePath);
  const sessionId = stringValue(parsed.sessionID) || stringValue(parsed.sessionId);
  const provider = stringValue(parsed.providerID) || stringValue(parsed.providerId) || "opencode";
  const model = stringValue(parsed.modelID) || stringValue(parsed.modelId);
  const agentName = stringValue(parsed.agent);
  const time = asRecord(parsed.time);

  return {
    id: `opencode-session:${hash(`${sessionId ?? "unknown"}:${messageId}`)}`,
    createdAt: timestampToIso(time?.completed) || timestampToIso(time?.created) || new Date().toISOString(),
    source: "opencode-session",
    agent: agentName ? `opencode:${agentName}` : "opencode",
    provider,
    model,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
    streaming: false,
  };
}

function parseStandardUsage(usage: Record<string, unknown> | undefined) {
  if (!usage) return undefined;
  const inputTokens = numberValue(usage.input_tokens);
  const outputTokens = numberValue(usage.output_tokens);
  const cacheReadTokens = numberValue(usage.cache_read_input_tokens);
  const cacheWriteTokens = numberValue(usage.cache_creation_input_tokens);
  if (inputTokens + outputTokens <= 0) return undefined;
  return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens };
}

function parseOpenClawUsage(usage: Record<string, unknown> | undefined) {
  if (!usage) return undefined;
  const inputTokens = numberValue(usage.input);
  const outputTokens = numberValue(usage.output);
  const cacheReadTokens = numberValue(usage.cacheRead);
  const cacheWriteTokens = numberValue(usage.cacheWrite);
  const totalTokens = numberValue(usage.totalTokens) || inputTokens + outputTokens;
  if (totalTokens <= 0) return undefined;
  return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens };
}

function readJsonFile(path: string) {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function listJsonlFiles(root: string) {
  const result: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl") && !entry.name.endsWith(".trajectory.jsonl")) {
        result.push(fullPath);
      }
    }
  };
  visit(root);
  return result;
}

function listJsonFiles(root: string) {
  const result: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        result.push(fullPath);
      }
    }
  };
  visit(root);
  return result;
}

function initialOffset(
  filePath: string,
  stats: Stats,
  settings: { importHistory: boolean; watcherStartedAt: number; historyStartAtMs?: number },
) {
  if (settings.historyStartAtMs && stats.mtimeMs >= settings.historyStartAtMs - 5_000) {
    return 0;
  }
  if (settings.importHistory && isTodaySessionPath(filePath)) {
    return 0;
  }
  if (stats.mtimeMs >= settings.watcherStartedAt - 5_000) {
    return 0;
  }
  return stats.size;
}

function shouldSkipInitialJsonFile(
  filePath: string,
  stats: Stats,
  settings: { importHistory: boolean; watcherStartedAt: number; historyStartAtMs?: number },
) {
  if (settings.historyStartAtMs && stats.mtimeMs >= settings.historyStartAtMs - 5_000) {
    return false;
  }
  if (settings.importHistory && isTodaySessionPath(filePath)) {
    return false;
  }
  return stats.mtimeMs < settings.watcherStartedAt - 5_000;
}

function readState(path: string): WatchState {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<WatchState>;
    return {
      files: parsed.files && typeof parsed.files === "object" ? parsed.files : {},
      historyStartAt: typeof parsed.historyStartAt === "string" ? parsed.historyStartAt : undefined,
    };
  } catch {
    return { files: {} };
  }
}

function writeState(path: string, state: WatchState) {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.tmp`;
  writeFileSync(tempPath, JSON.stringify(state, null, 2), "utf8");
  renameSync(tempPath, path);
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

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function timestampToIso(value: unknown) {
  if (typeof value === "string") {
    const time = Date.parse(value);
    return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  const milliseconds = value > 1_000_000_000_000 ? value : value * 1000;
  return new Date(milliseconds).toISOString();
}

function timestampMs(value: string | undefined) {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : undefined;
}

function isBeforeHistoryStart(createdAt: string, historyStartAtMs: number | undefined) {
  if (!historyStartAtMs) return false;
  const time = Date.parse(createdAt);
  return Number.isFinite(time) && time < historyStartAtMs;
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

function defaultOpenCodeMessagesRoot() {
  if (process.env.XDG_DATA_HOME) {
    return join(process.env.XDG_DATA_HOME, "opencode", "storage", "message");
  }
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return join(process.env.LOCALAPPDATA, "opencode", "storage", "message");
  }
  return join(homedir(), ".local", "share", "opencode", "storage", "message");
}
