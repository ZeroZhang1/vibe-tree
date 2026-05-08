import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import type { AddressInfo } from "node:net";
import type { UsageEvent } from "../shared/types.js";

interface UsageGatewayOptions {
  userDataPath: string;
  onUsage: (event: UsageEvent) => void;
  onStatus?: (status: UsageGatewayStatus) => void;
}

export interface UsageGatewayStatus {
  running: boolean;
  port: number;
  targetBaseUrl: string;
  hasUpstreamKey: boolean;
  error?: string;
}

interface GatewayConfig {
  host: string;
  port: number;
  targetBaseUrl: string;
  upstreamApiKey?: string;
  localApiKey?: string;
}

interface NormalizedUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
}

interface RequestRecord {
  id: string;
  method: string;
  path: string;
  createdAt: string;
  agent: string;
  provider: string;
  model?: string;
  status?: number;
  durationMs?: number;
  streaming: boolean;
  usage?: NormalizedUsage;
}

const DEFAULT_PORT = 18790;
const DEFAULT_TARGET_BASE_URL = "https://api.openai.com";
const MAX_CAPTURED_RESPONSE_BYTES = 2_000_000;

export function startUsageGateway(options: UsageGatewayOptions) {
  const config = readGatewayConfig();
  let status: UsageGatewayStatus = {
    running: false,
    port: config.port,
    targetBaseUrl: config.targetBaseUrl,
    hasUpstreamKey: Boolean(config.upstreamApiKey),
  };

  const server = createServer((request, response) => {
    proxyRequest(request, response, config, options).catch((error: unknown) => {
      writeError(response, 502, error instanceof Error ? error.message : String(error));
    });
  });

  server.on("error", (error: NodeJS.ErrnoException) => {
    status = {
      ...status,
      running: false,
      error: error.code === "EADDRINUSE" ? `Port ${config.port} is already in use` : error.message,
    };
    options.onStatus?.(status);
  });

  server.listen(config.port, config.host, () => {
    const address = server.address() as AddressInfo;
    status = {
      running: true,
      port: address.port,
      targetBaseUrl: config.targetBaseUrl,
      hasUpstreamKey: Boolean(config.upstreamApiKey),
    };
    options.onStatus?.(status);
  });

  return {
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
    getStatus: () => status,
  };
}

function readGatewayConfig(): GatewayConfig {
  return {
    host: "127.0.0.1",
    port: numberFromEnv("VIBE_GATEWAY_PORT", DEFAULT_PORT),
    targetBaseUrl: trimTrailingSlash(
      process.env.VIBE_GATEWAY_TARGET_BASE_URL || process.env.OPENAI_BASE_URL || DEFAULT_TARGET_BASE_URL,
    ),
    upstreamApiKey: process.env.VIBE_GATEWAY_UPSTREAM_API_KEY || process.env.OPENAI_API_KEY,
    localApiKey: process.env.VIBE_GATEWAY_LOCAL_API_KEY,
  };
}

async function proxyRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: GatewayConfig,
  options: UsageGatewayOptions,
) {
  if (!request.url || !request.method) {
    writeError(response, 400, "Missing request URL or method");
    return;
  }

  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        ok: true,
        service: "vibe-token-gateway",
        targetBaseUrl: config.targetBaseUrl,
        hasUpstreamKey: Boolean(config.upstreamApiKey),
      }),
    );
    return;
  }

  if (!request.url.startsWith("/v1/")) {
    writeError(response, 404, "Only /v1/* routes are proxied in the first version");
    return;
  }

  if (!config.upstreamApiKey) {
    writeError(response, 502, "Missing upstream API key. Set VIBE_GATEWAY_UPSTREAM_API_KEY or OPENAI_API_KEY.");
    return;
  }

  if (config.localApiKey && bearerToken(request.headers.authorization) !== config.localApiKey) {
    writeError(response, 401, "Invalid local gateway API key");
    return;
  }

  const startedAt = Date.now();
  const body = await readRequestBody(request);
  const requestJson = parseJsonBody(body);
  const upstreamUrl = `${config.targetBaseUrl}${request.url}`;
  const requestRecord: RequestRecord = {
    id: randomUUID(),
    method: request.method,
    path: request.url,
    createdAt: new Date(startedAt).toISOString(),
    agent: request.headers["x-vibe-agent"]?.toString() || "codex",
    provider: providerFromBaseUrl(config.targetBaseUrl),
    model: typeof requestJson?.model === "string" ? requestJson.model : undefined,
    streaming: Boolean(requestJson?.stream),
  };

  const headers = copyHeaders(request);
  headers.set("authorization", `Bearer ${config.upstreamApiKey}`);
  headers.delete("host");
  headers.delete("content-length");

  const upstream = await fetch(upstreamUrl, {
    method: request.method,
    headers,
    body: shouldSendBody(request.method) ? body : undefined,
  });

  requestRecord.status = upstream.status;
  copyResponseHeaders(upstream, response);

  const captured = await relayResponse(upstream, response);
  requestRecord.durationMs = Date.now() - startedAt;
  applyCapturedUsage(requestRecord, captured);
  recordRequest(options.userDataPath, requestRecord);

  if (requestRecord.usage && requestRecord.usage.totalTokens > 0) {
    options.onUsage({
      id: requestRecord.id,
      createdAt: requestRecord.createdAt,
      source: "gateway:codex",
      agent: requestRecord.agent,
      provider: requestRecord.provider,
      model: requestRecord.model,
      inputTokens: requestRecord.usage.inputTokens,
      outputTokens: requestRecord.usage.outputTokens,
      cacheReadTokens: requestRecord.usage.cacheReadTokens,
      cacheWriteTokens: requestRecord.usage.cacheWriteTokens,
      totalTokens: requestRecord.usage.totalTokens,
      status: requestRecord.status,
      durationMs: requestRecord.durationMs,
      streaming: requestRecord.streaming,
    });
  }
}

function copyHeaders(request: IncomingMessage) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      headers.set(name, value.join(", "));
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
}

function copyResponseHeaders(upstream: Response, response: ServerResponse) {
  upstream.headers.forEach((value, name) => {
    if (name.toLowerCase() !== "content-encoding") {
      response.setHeader(name, value);
    }
  });
  response.writeHead(upstream.status, upstream.statusText);
}

async function relayResponse(upstream: Response, response: ServerResponse) {
  if (!upstream.body) {
    const text = await upstream.text();
    response.end(text);
    return text;
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const captured: string[] = [];
  let capturedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    response.write(Buffer.from(value));
    if (capturedBytes < MAX_CAPTURED_RESPONSE_BYTES) {
      capturedBytes += value.byteLength;
      captured.push(decoder.decode(value, { stream: true }));
    }
  }

  captured.push(decoder.decode());
  response.end();
  return captured.join("");
}

function applyCapturedUsage(record: RequestRecord, captured: string) {
  const usageCandidates = extractUsageCandidates(captured);
  const lastUsage = usageCandidates.at(-1);
  if (lastUsage) {
    record.usage = normalizeUsage(lastUsage);
  }

  const model = extractModel(captured);
  if (model) {
    record.model = model;
  }
}

function extractUsageCandidates(captured: string) {
  const candidates: unknown[] = [];
  const trimmed = captured.trim();
  const parsed = parseJson(trimmed);
  if (parsed) {
    collectUsage(parsed, candidates);
  }

  for (const line of captured.split(/\r?\n/)) {
    const data = line.startsWith("data:") ? line.slice(5).trim() : "";
    if (!data || data === "[DONE]") continue;
    const event = parseJson(data);
    if (event) {
      collectUsage(event, candidates);
    }
  }

  return candidates;
}

function collectUsage(value: unknown, candidates: unknown[]) {
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (looksLikeUsage(record.usage)) {
    candidates.push(record.usage);
  }
  if (record.response && typeof record.response === "object") {
    const response = record.response as Record<string, unknown>;
    if (looksLikeUsage(response.usage)) {
      candidates.push(response.usage);
    }
  }
}

function looksLikeUsage(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return [
    "total_tokens",
    "input_tokens",
    "output_tokens",
    "prompt_tokens",
    "completion_tokens",
    "cache_read_input_tokens",
    "cached_input_tokens",
    "cached_tokens",
    "cache_creation_input_tokens",
  ].some((key) => typeof record[key] === "number");
}

function normalizeUsage(value: unknown): NormalizedUsage {
  const usage = (value ?? {}) as Record<string, unknown>;
  const inputTokens = numberField(usage, "input_tokens") || numberField(usage, "prompt_tokens");
  const outputTokens = numberField(usage, "output_tokens") || numberField(usage, "completion_tokens");
  const cacheReadTokens =
    numberField(usage, "cache_read_input_tokens") ||
    numberField(usage, "cached_input_tokens") ||
    numberField(usage, "cached_tokens") ||
    numberFromNested(usage, "input_tokens_details", "cached_tokens") ||
    numberFromNested(usage, "prompt_tokens_details", "cached_tokens");
  const cacheWriteTokens = numberField(usage, "cache_creation_input_tokens");
  const totalTokens = numberField(usage, "total_tokens") || inputTokens + outputTokens;

  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
  };
}

function extractModel(captured: string) {
  const parsed = parseJson(captured.trim());
  if (parsed && typeof parsed === "object") {
    const model = (parsed as Record<string, unknown>).model;
    if (typeof model === "string") return model;
  }
  return undefined;
}

function recordRequest(userDataPath: string, record: RequestRecord) {
  const path = join(userDataPath, "usage-gateway.jsonl");
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
}

async function readRequestBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function parseJsonBody(body: Buffer) {
  if (!body.length) return undefined;
  return parseJson(body.toString("utf8"));
}

function parseJson(value: string) {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function shouldSendBody(method: string) {
  return !["GET", "HEAD"].includes(method.toUpperCase());
}

function writeError(response: ServerResponse, status: number, message: string) {
  if (response.headersSent) {
    response.end();
    return;
  }
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: { message } }));
}

function bearerToken(value: string | undefined) {
  if (!value) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match?.[1];
}

function providerFromBaseUrl(baseUrl: string) {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return "openai-compatible";
  }
}

function numberFromEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

function numberField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function numberFromNested(record: Record<string, unknown>, objectKey: string, numberKey: string) {
  const nested = record[objectKey];
  if (!nested || typeof nested !== "object") return 0;
  return numberField(nested as Record<string, unknown>, numberKey);
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}
