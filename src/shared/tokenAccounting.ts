import type { LedgerEntry } from "./types.js";

export function countedTokensForEntry(entry: LedgerEntry) {
  if (entry.source === "cloud-sync" || entry.syncedFromCloud) return safeTokens(entry.tokens);
  if (!hasTokenBreakdown(entry)) return safeTokens(entry.tokens);

  const inputTokens = countedInputTokensForEntry(entry);
  const outputTokens = safeTokens(entry.outputTokens ?? 0);
  const cacheReadTokens = safeTokens(entry.cacheReadTokens ?? 0);
  const cacheWriteTokens = safeTokens(entry.cacheWriteTokens ?? 0);
  return inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
}

export function countedInputTokensForEntry(entry: LedgerEntry) {
  const inputTokens = safeTokens(entry.inputTokens ?? 0);
  const cacheReadTokens = safeTokens(entry.cacheReadTokens ?? 0);
  return inputTokensIncludeCacheRead(entry) ? Math.max(0, inputTokens - cacheReadTokens) : inputTokens;
}

function hasTokenBreakdown(entry: LedgerEntry) {
  return (
    entry.inputTokens !== undefined ||
    entry.outputTokens !== undefined ||
    entry.cacheReadTokens !== undefined ||
    entry.cacheWriteTokens !== undefined
  );
}

function inputTokensIncludeCacheRead(entry: LedgerEntry) {
  return (
    entry.source === "codex-session" ||
    entry.agent === "codex-desktop" ||
    entry.source === "gemini-session" ||
    (entry.source === "cloud-sync" && (entry.id.startsWith("codex-session:") || entry.id.startsWith("gemini-session:")))
  );
}

function safeTokens(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
