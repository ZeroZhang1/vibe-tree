import { formatCompact, clamp } from "./format";
import { AGENT_SOURCES } from "./sources";
import type { HistoryDayRow, HistoryFilter, SourceVisibility } from "./types";

interface RenderHistoryChartOptions {
  rows: HistoryDayRow[];
  filter: HistoryFilter;
  visibility: SourceVisibility;
  lastHistoryChartKey: string;
  historySummary: HTMLElement | null;
  historyLegend: HTMLElement | null;
  historyTabs: HTMLElement | null;
  historyBars: HTMLElement | null;
  t: (key: string) => string;
  escapeHtml: (value: string) => string;
}

export function renderHistoryChart(options: RenderHistoryChartOptions) {
  const { rows, filter, visibility, historySummary, historyLegend, historyTabs, historyBars, t, escapeHtml } = options;
  const visibleSources = visibility.visible;
  const labels = Object.fromEntries([
    ["all", t("historyAllSources")],
    ...AGENT_SOURCES.map((source) => [source.id, source.label]),
  ]) as Record<HistoryFilter, string>;
  const total = rows.reduce((sum, row) => sum + row.tokens, 0);
  const max = Math.max(1, ...rows.map((row) => row.tokens));

  if (historySummary) historySummary.textContent = `${labels[filter]} · ${formatCompact(total)} token`;
  if (historyLegend) {
    historyLegend.innerHTML = filter === "all" ? historyAgentLegendHtml(visibility, escapeHtml) : historyTokenLegendHtml();
  }

  historyTabs?.querySelectorAll<HTMLButtonElement>("[data-history-filter]").forEach((button) => {
    const sourceId = button.dataset.historyFilter as HistoryFilter | undefined;
    button.hidden = Boolean(sourceId && sourceId !== "all" && !visibleSources.includes(sourceId));
    const active = sourceId === filter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });

  if (!historyBars) return options.lastHistoryChartKey;
  const chartKey = historyChartKey(rows, filter, visibility);
  if (chartKey === options.lastHistoryChartKey && historyBars.childElementCount > 0) return options.lastHistoryChartKey;

  historyBars.innerHTML = rows
    .map((row) => {
      const segmentTotal = filter === "all" ? row.tokens : row.tokens + row.cacheReadTokens + row.cacheWriteTokens;
      const height = row.tokens > 0 ? scaledHistoryHeight(row.tokens, max) : 0;
      const segments =
        filter === "all"
          ? visibleSources
              .map(
                (sourceId) =>
                  `<span class="history-segment ${sourceId}" style="height:${segmentPercent(row.sources[sourceId], segmentTotal)}%"></span>`,
              )
              .join("")
          : `
              <span class="history-segment input" style="height:${segmentPercent(row.inputTokens, segmentTotal)}%"></span>
              <span class="history-segment output" style="height:${segmentPercent(row.outputTokens, segmentTotal)}%"></span>
              <span class="history-segment cache-read" style="height:${segmentPercent(row.cacheReadTokens, segmentTotal)}%"></span>
              <span class="history-segment cache-write" style="height:${segmentPercent(row.cacheWriteTokens, segmentTotal)}%"></span>
            `;
      return `
        <article class="history-day" tabindex="0">
          <div class="history-bar-shell">
            <div class="history-stack" style="height:${height}%">
              ${segments}
            </div>
          </div>
          ${historyTooltipHtml(row, filter, visibility, escapeHtml)}
          <strong>${formatCompact(row.tokens)}</strong>
          <span>${row.label}</span>
        </article>
      `;
    })
    .join("");
  return chartKey;
}

function historyChartKey(rows: HistoryDayRow[], filter: HistoryFilter, visibility: SourceVisibility) {
  const visibleSources = visibility.visible;
  return JSON.stringify({
    filter,
    visibleSources,
    rows: rows.map((row) => [
      row.label,
      row.tokens,
      row.inputTokens,
      row.outputTokens,
      row.cacheReadTokens,
      row.cacheWriteTokens,
      ...visibleSources.map((sourceId) => row.sources[sourceId]),
    ]),
  });
}

function historyTooltipHtml(
  row: HistoryDayRow,
  filter: HistoryFilter,
  visibility: SourceVisibility,
  escapeHtml: (value: string) => string,
) {
  const items =
    filter === "all"
      ? visibility.visible.map((sourceId) => ({
          label: AGENT_SOURCES.find((source) => source.id === sourceId)?.label ?? sourceId,
          value: row.sources[sourceId],
          tone: sourceId,
        }))
      : [
          { label: "input", value: row.inputTokens, tone: "input" },
          { label: "output", value: row.outputTokens, tone: "output" },
          { label: "cache hit", value: row.cacheReadTokens, tone: "cache-read" },
          { label: "cache write", value: row.cacheWriteTokens, tone: "cache-write" },
        ];

  return `
    <div class="history-tooltip" role="tooltip">
      <div class="history-tooltip-head">
        <span>${escapeHtml(row.label)}</span>
        <strong>${formatCompact(row.tokens)} token</strong>
      </div>
      <div class="history-tooltip-items">
        ${items
          .map(
            (item) => `
              <span class="${item.value > 0 ? "" : "empty"}">
                <i class="history-tooltip-dot ${item.tone}"></i>
                <b>${escapeHtml(item.label)}</b>
                <em>${formatCompact(item.value)}</em>
              </span>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function historyTokenLegendHtml() {
  return `
    <span><i class="legend-input"></i>input</span>
    <span><i class="legend-output"></i>output</span>
    <span><i class="legend-cache-read"></i>cache hit</span>
    <span><i class="legend-cache-write"></i>cache write</span>
  `;
}

function historyAgentLegendHtml(visibility: SourceVisibility, escapeHtml: (value: string) => string) {
  return visibility.visible
    .map((sourceId) => {
      const source = AGENT_SOURCES.find((item) => item.id === sourceId);
      return `<span><i class="legend-${sourceId}"></i>${escapeHtml(source?.label ?? sourceId)}</span>`;
    })
    .join("");
}

function segmentPercent(value: number, total: number) {
  if (value <= 0 || total <= 0) return 0;
  return Math.max(4, Math.round((value / total) * 100));
}

function scaledHistoryHeight(value: number, max: number) {
  if (value <= 0 || max <= 0) return 0;
  return clamp((value / max) * 100, 1.5, 100);
}
