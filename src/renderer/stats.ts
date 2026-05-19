import type { LedgerEntry, TreeAsset } from "../shared/types";
import { countedInputTokensForEntry } from "../shared/tokenAccounting";
import { clamp, dateKey } from "./format";
import { emptySourceTotals, historySourceId, safeTokens, xpForEntry } from "./sources";
import { treeStatsSignature } from "./treeAssets";
import type { BaseStatsSnapshot, GameBalance, HistoryDayRow, HistoryFilter, HistorySourceId, SourceVisibility, Stats, WeatherState } from "./types";

export class StatsCache {
  private baseStatsCacheKey = "";
  private cachedBaseStats: BaseStatsSnapshot | undefined;
  private historyRowsCacheKey = "";
  private cachedHistoryRows: HistoryDayRow[] = [];

  calculateStats(
    entries: LedgerEntry[],
    asset: TreeAsset,
    balance: GameBalance,
    enabledSources: Set<HistorySourceId>,
    entriesSignature: string,
    now = Date.now(),
  ): Stats {
    const base = this.getBaseStats(entries, asset, balance, enabledSources, entriesSignature);
    const recent = getRecentStats(entries, now, balance, enabledSources);
    return {
      ...base,
      ...recent,
    };
  }

  getSevenDayRows(
    entries: LedgerEntry[],
    filter: HistoryFilter,
    visibility: SourceVisibility,
    entriesSignature: string,
    today = new Date(),
  ) {
    const key = [
      entriesSignature,
      dateKey(today),
      filter,
      [...visibility.enabled].join(","),
      visibility.visible.join(","),
    ].join("|");
    if (key !== this.historyRowsCacheKey) {
      this.cachedHistoryRows = getSevenDayRows(entries, filter, visibility, today);
      this.historyRowsCacheKey = key;
    }
    return this.cachedHistoryRows;
  }

  private getBaseStats(
    entries: LedgerEntry[],
    asset: TreeAsset,
    balance: GameBalance,
    enabledSources: Set<HistorySourceId>,
    entriesSignature: string,
  ): BaseStatsSnapshot {
    const key = [
      entriesSignature,
      dateKey(new Date()),
      [...enabledSources].join(","),
      treeStatsSignature(asset, balance),
    ].join("|");
    if (this.cachedBaseStats && key === this.baseStatsCacheKey) return this.cachedBaseStats;

    const todayKey = dateKey(new Date());
    let xp = 0;
    let todayXp = 0;
    for (const entry of entries) {
      const entryXp = xpForEntry(entry, enabledSources);
      if (entryXp <= 0) continue;
      const createdAtMs = Date.parse(entry.createdAt);
      if (!Number.isFinite(createdAtMs)) continue;
      xp += entryXp;
      if (dateKey(new Date(createdAtMs)) === todayKey) todayXp += entryXp;
    }

    const levelState = getLevelState(xp, balance);
    const stageInfo = getStageForLevel(levelState.level, balance);
    const stage = asset.stages.find((item) => item.id === stageInfo.id) ?? asset.stages[0];
    const nextStage = getNextStageForLevel(levelState.level, balance);
    const stageProgress = getStageProgress(levelState.level, balance);

    this.cachedBaseStats = {
      xp,
      todayXp,
      level: levelState.level,
      levelXp: levelState.levelXp,
      nextLevelXp: levelState.nextLevelXp,
      levelProgress: levelState.progress,
      stage,
      nextStageLabel: nextStage?.label,
      stageProgress,
    };
    this.baseStatsCacheKey = key;
    return this.cachedBaseStats;
  }
}

function getRecentStats(
  entries: LedgerEntry[],
  now: number,
  balance: GameBalance,
  enabledSources: Set<HistorySourceId>,
): Pick<Stats, "weather" | "lastFiveMinuteXp" | "recentXp" | "activeSessions"> {
  const peakWindowAgo = now - balance.activity.peakWindowSeconds * 1000;
  const activeWindowAgo = now - balance.activity.activeWindowSeconds * 1000;
  const weatherWindowAgo = now - balance.weather.rateWindowSeconds * 1000;
  const oldestWindowAgo = Math.min(peakWindowAgo, activeWindowAgo, weatherWindowAgo);
  let lastFiveMinuteXp = 0;
  let recentXp = 0;
  let weatherWindowXp = 0;
  const activeSessionKeys = new Set<string>();

  for (const entry of entries) {
    const createdAtMs = Date.parse(entry.createdAt);
    if (!Number.isFinite(createdAtMs)) continue;
    if (createdAtMs < oldestWindowAgo) break;
    const entryXp = xpForEntry(entry, enabledSources);
    if (entryXp <= 0) continue;

    if (createdAtMs >= peakWindowAgo) lastFiveMinuteXp += entryXp;
    if (createdAtMs >= activeWindowAgo) {
      recentXp += entryXp;
      activeSessionKeys.add(entry.agent || entry.source);
    }
    if (createdAtMs >= weatherWindowAgo) weatherWindowXp += entryXp;
  }

  const weather = getWeather((weatherWindowXp / balance.weather.rateWindowSeconds) * 60, balance);

  return {
    weather,
    lastFiveMinuteXp,
    recentXp,
    activeSessions: activeSessionKeys.size,
  };
}

function getSevenDayRows(entries: LedgerEntry[], filter: HistoryFilter = "all", visibility: SourceVisibility, today: Date) {
  const rows = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(date.getDate() - (6 - index));
    return {
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      key: dateKey(date),
      tokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      sources: emptySourceTotals(),
    };
  });
  const rowsByKey = new Map(rows.map((row) => [row.key, row]));

  for (const entry of entries) {
    const source = historySourceId(entry);
    if (!source || !visibility.visibleSet.has(source)) continue;
    if (filter !== "all" && source !== filter) continue;
    const row = rowsByKey.get(dateKey(new Date(entry.createdAt)));
    if (!row) continue;
    const entryXp = xpForEntry(entry, visibility.enabled);
    if (entryXp <= 0) continue;

    row.tokens += entryXp;
    row.inputTokens += countedInputTokensForEntry(entry);
    row.outputTokens += safeTokens(entry.outputTokens ?? 0);
    row.cacheReadTokens += safeTokens(entry.cacheReadTokens ?? 0);
    row.cacheWriteTokens += safeTokens(entry.cacheWriteTokens ?? 0);
    row.sources[source] += entryXp;
  }

  return rows.map(({ key: _key, ...row }) => row);
}

function getLevelState(totalXp: number, balance: GameBalance) {
  let level = 1;
  let remaining = totalXp;
  let needed = xpForNextLevel(level, balance);
  while (remaining >= needed && level < balance.xp.maxLevel) {
    remaining -= needed;
    level += 1;
    needed = xpForNextLevel(level, balance);
  }
  return {
    level,
    levelXp: remaining,
    nextLevelXp: needed,
    progress: needed ? clamp(remaining / needed, 0, 1) : 1,
  };
}

function xpForNextLevel(level: number, balance: GameBalance) {
  return Math.round(balance.xp.levelBase * level ** balance.xp.levelExponent);
}

function getStageForLevel(level: number, balance: GameBalance) {
  return balance.stages.reduce((current, stage) => (level >= stage.minLevel ? stage : current), balance.stages[0]);
}

function getNextStageForLevel(level: number, balance: GameBalance) {
  return balance.stages.find((stage) => stage.minLevel > level);
}

function getStageProgress(level: number, balance: GameBalance) {
  const current = getStageForLevel(level, balance);
  const next = getNextStageForLevel(level, balance);
  if (!next) return 1;
  return clamp((level - current.minLevel) / (next.minLevel - current.minLevel), 0, 1);
}

function getWeather(tokensPerMinute: number, balance: GameBalance): WeatherState {
  const state = balance.weather.thresholds.reduce((current, candidate) => {
    return tokensPerMinute >= candidate.minXpPerMinute ? candidate : current;
  }, balance.weather.thresholds[0]);
  const maxWeatherRate = balance.weather.thresholds[balance.weather.thresholds.length - 1]?.minXpPerMinute || 1;
  return {
    id: state.id,
    label: state.label,
    tokensPerMinute,
    activity: clamp(tokensPerMinute / maxWeatherRate, 0, 1),
  };
}
