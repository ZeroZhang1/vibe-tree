import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  statSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import { dirname, join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { SessionMonitorStatus, UsageEvent } from "../shared/types.js";

interface SessionWatcherOptions {
  userDataPath: string;
  onUsage: (event: UsageEvent) => void;
  onStatus?: (status: SessionMonitorStatus) => void;
}

interface WatchState {
  files: Record<string, number>;
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

const READ_CHUNK_SIZE = 64 * 1024;
const DEFAULT_CLAUDE_ROOT = join(process.env.USERPROFILE || "", ".claude", "projects");
const DEFAULT_OPENCLAW_ROOT = join(process.env.USERPROFILE || "", ".openclaw", "agents");

export function startClaudeSessionWatcher(options: SessionWatcherOptions) {
  return startAgentSessionWatcher(options, {
    source: "claude-session",
    agent: "claude-code",
    sessionsRoot: process.env.VIBE_CLAUDE_SESSIONS_DIR || DEFAULT_CLAUDE_ROOT,
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
    sessionsRoot: process.env.VIBE_OPENCLAW_SESSIONS_DIR || DEFAULT_OPENCLAW_ROOT,
    importHistoryEnv: "VIBE_OPENCLAW_IMPORT_HISTORY",
    stateFileName: "openclaw-session-watcher.json",
    pollIntervalMs: 10_000,
    parseLine: parseOpenClawLine,
  });
}

function startAgentSessionWatcher(options: SessionWatcherOptions, config: AgentConfig) {
  const importHistory = process.env[config.importHistoryEnv] === "today";
  const statePath = join(options.userDataPath, config.stateFileName);
  const state = readState(statePath);
  const watcherStartedAt = Date.now();
  const status: SessionMonitorStatus = {
    running: true,
    sessionsRoot: config.sessionsRoot,
    exists: existsSync(config.sessionsRoot),
    filesWatched: 0,
    eventsImported: 0,
    importHistory,
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
      const imported = scanFile(filePath, state, statePath, config, { importHistory, watcherStartedAt }, options.onUsage);
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
  settings: { importHistory: boolean; watcherStartedAt: number },
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
    onUsage(event);
    return 1;
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

function initialOffset(filePath: string, stats: Stats, settings: { importHistory: boolean; watcherStartedAt: number }) {
  if (settings.importHistory && isTodaySessionPath(filePath)) {
    return 0;
  }
  if (stats.mtimeMs >= settings.watcherStartedAt - 5_000) {
    return 0;
  }
  return stats.size;
}

function readState(path: string): WatchState {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<WatchState>;
    return {
      files: parsed.files && typeof parsed.files === "object" ? parsed.files : {},
    };
  } catch {
    return { files: {} };
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

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
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
