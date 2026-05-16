import type { LedgerEntry } from "./types.js";

export function countedTokensForEntry(entry: LedgerEntry) {
  if (!hasTokenBreakdown(entry)) return safeTokens(entry.tokens);

  const inputTokens = safeTokens(entry.inputTokens ?? 0);
  const outputTokens = safeTokens(entry.outputTokens ?? 0);
  const billableInputTokens = usesInclusiveCacheReadInput(entry)
    ? Math.max(0, inputTokens - safeTokens(entry.cacheReadTokens ?? 0))
    : inputTokens;
  return billableInputTokens + outputTokens + safeTokens(entry.cacheWriteTokens ?? 0);
}

function hasTokenBreakdown(entry: LedgerEntry) {
  return (
    entry.inputTokens !== undefined ||
    entry.outputTokens !== undefined ||
    entry.cacheReadTokens !== undefined ||
    entry.cacheWriteTokens !== undefined
  );
}

function usesInclusiveCacheReadInput(entry: LedgerEntry) {
  return entry.source === "codex-session" || entry.agent === "codex-desktop" || entry.source === "gemini-session";
}

function safeTokens(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
