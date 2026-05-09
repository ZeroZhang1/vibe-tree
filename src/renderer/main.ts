import type { LedgerEntry, LedgerFile, TreeAsset, TreeStage, UsageStatus, WindowBounds } from "../shared/types";
import "./styles.css";

type WeatherId = "clear" | "breeze" | "drizzle" | "rain" | "thunder" | "storm";
type ViewMode = "pet" | "manager";
type HistoryFilter = "all" | "codex" | "openclaw" | "opencode" | "claude";
type BadgeMetric = "level" | "total" | "rate";
type TotalDisplayUnit = "k" | "m";

interface WeatherState {
  id: WeatherId;
  label: string;
  tokensPerMinute: number;
  activity: number;
}

interface Stats {
  xp: number;
  todayXp: number;
  level: number;
  levelXp: number;
  nextLevelXp: number;
  levelProgress: number;
  stage: TreeStage;
  nextStageLabel?: string;
  stageProgress: number;
  weather: WeatherState;
  lastFiveMinuteXp: number;
  recentXp: number;
  activeSessions: number;
  sevenDays: HistoryDayRow[];
  sourceBreakdown: SourceBreakdown[];
}

interface HistoryDayRow {
  label: string;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  sources: Record<HistorySourceId, number>;
}

type HistorySourceId = "codex" | "openclaw" | "opencode" | "claude";

interface SourceBreakdown {
  id: string;
  label: string;
  xp: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

interface PureSvgManifest {
  stages: Array<{
    id: string;
    label: string;
    asset: string;
  }>;
}

interface GameBalance {
  xp: {
    levelBase: number;
    levelExponent: number;
    maxLevel: number;
  };
  weather: {
    rateWindowSeconds: number;
    thresholds: Array<{ id: WeatherId; label: string; minXpPerMinute: number }>;
  };
  activity: {
    activeWindowSeconds: number;
    peakWindowSeconds: number;
  };
  stages: Array<{ minLevel: number; id: string; label: string }>;
}

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app");
document.title = "Vibe Tree";

const viewMode: ViewMode = new URLSearchParams(location.search).get("view") === "manager" ? "manager" : "pet";
let ledger: LedgerFile | null = null;
let tree: TreeAsset | null = null;
let gameBalance: GameBalance | null = null;
let usageStatus: UsageStatus | null = null;
let lastWeatherId: WeatherId | null = null;
let lastRenderedLevel: number | null = null;
let levelUpTimer: number | undefined;
let pendingLevelUp: { from: number; to: number } | null = null;
const AUTO_BADGE_FLIP_MS = 30_000;
const BADGE_TOKEN_HOLD_MS = 1_800;
const badgeFlipTimers = new Map<string, number>();
let badgeAutoFlipTimer: number | undefined;
let historyFilter: HistoryFilter = "all";
let expandedSourceKey: string | null = null;
let dragState: null | {
  startMouse: { x: number; y: number };
  startBounds: WindowBounds;
} = null;

if (viewMode === "pet") {
  app.innerHTML = `
    <main class="pet-root" data-locked="false" data-weather="clear" data-active="false">
      <section class="pet-stage" id="petStage" aria-label="Vibe Tree">
        <div class="weather-layer weather-back" id="weatherBack"></div>
        <div class="pet-aura"></div>
        <img class="tree-image" id="treeImage" alt="Vibe Tree" draggable="false" />
        <div class="weather-layer weather-front" id="weatherFront"></div>
        <div class="level-up-toast" aria-hidden="true">
          <strong>LEVEL UP!</strong>
          <span id="petLevelUpText">Lv.1 -> Lv.2</span>
        </div>
        <div class="level-badge" id="petLevelBadge">
          <span class="badge-card">
            <span class="badge-face badge-front">Lv.1</span>
            <span class="badge-face badge-back">0</span>
          </span>
        </div>
        <button class="pet-hitbox" id="petHitbox" type="button" aria-label="打开 Vibe Tree"></button>
      </section>
    </main>
  `;
} else {
  app.innerHTML = `
    <main class="manager-root" data-weather="clear" data-active="false">
      <aside class="pet-preview-panel">
        <header class="app-title">
          <p>Vibe Tree</p>
          <h1>Token 天气树</h1>
        </header>

        <section class="preview-stage" aria-label="桌面小树预览">
          <div class="weather-layer weather-back" id="previewWeatherBack"></div>
          <div class="pet-aura"></div>
          <img class="tree-image" id="previewTreeImage" alt="Vibe Tree preview" draggable="false" />
          <div class="weather-layer weather-front" id="previewWeatherFront"></div>
          <div class="level-up-toast" aria-hidden="true">
            <strong>LEVEL UP!</strong>
            <span id="previewLevelUpText">Lv.1 -> Lv.2</span>
          </div>
          <div class="level-badge preview-level" id="previewLevelBadge">
            <span class="badge-card">
              <span class="badge-face badge-front">Lv.1</span>
              <span class="badge-face badge-back">0</span>
            </span>
          </div>
        </section>

      </aside>
      <button class="settings-fab" id="settingsButton" type="button" aria-label="打开设置" title="设置">⚙</button>

      <section class="dashboard">
        <header class="dashboard-header">
          <div>
            <p class="eyebrow">Live growth</p>
            <h2 id="levelTitle">Lv.1 新芽</h2>
          </div>
          <div class="weather-readout">
            <span id="weatherLabel">晴朗</span>
            <strong id="weatherRateText">0 XP/min</strong>
          </div>
        </header>

        <div class="metric-grid">
          <article>
            <span>累计 XP</span>
            <strong id="totalText">0</strong>
          </article>
          <article>
            <span>今日成长</span>
            <strong id="todayText">0</strong>
          </article>
          <article>
            <span>活跃会话</span>
            <strong id="activeSessionsText">0</strong>
          </article>
        </div>

        <section class="progress-block">
          <div class="progress-meta">
            <span id="nextLevelText">距离 Lv.2</span>
            <span id="progressText">0 / 800 XP</span>
          </div>
          <div class="progress-track xp-track">
            <span id="progressBar"></span>
          </div>
        </section>

        <section class="source-card" aria-label="Token 来源">
          <div class="section-header">
            <h3>数据来源</h3>
            <span id="sourceSummary">等待 token</span>
          </div>
          <div class="source-rows" id="sourceBreakdown"></div>
        </section>

        <section class="chart-card">
          <div class="section-header">
            <h3>最近 7 天</h3>
            <span id="peakText">5 分钟 +0 XP</span>
          </div>
        </section>
      </section>

      <section class="settings-modal" id="settingsModal" aria-hidden="true">
        <div class="settings-backdrop" id="settingsBackdrop"></div>
        <div class="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settingsTitle">
          <header class="settings-panel-header">
            <div>
              <p class="eyebrow">偏好设置</p>
              <h3 id="settingsTitle">设置</h3>
            </div>
            <button class="icon-button" id="settingsCloseButton" type="button" aria-label="关闭设置">×</button>
          </header>

          <section class="settings-section">
            <h4>桌面小树</h4>
            <div class="pet-settings" aria-label="桌面小树设置">
              <label class="scale-select">
                大小
                <select id="scaleSelect">
                  <option value="0.5">0.5x</option>
                  <option value="1">1x</option>
                  <option value="1.5">1.5x</option>
                  <option value="2">2x</option>
                </select>
              </label>
              <label class="toggle-row">
                <input id="lockInput" type="checkbox" />
                <span>锁定小树位置</span>
              </label>
            </div>
          </section>

          <section class="settings-section">
            <h4>牌子显示</h4>
            <div class="badge-settings" aria-label="牌子显示">
              <label>
                正面
                <select id="badgeFrontMetricSelect">
                  <option value="level">等级</option>
                  <option value="total">累计 token</option>
                  <option value="rate">token/s</option>
                </select>
              </label>
              <label>
                背面
                <select id="badgeBackMetricSelect">
                  <option value="level">等级</option>
                  <option value="total">累计 token</option>
                  <option value="rate">token/s</option>
                </select>
              </label>
              <label>
                总量单位
                <select id="totalDisplayUnitSelect">
                  <option value="k">k</option>
                  <option value="m">m</option>
                </select>
              </label>
            </div>
          </section>

          <section class="settings-section">
            <h4>设备</h4>
            <div class="device-controls" aria-label="设备设置">
              <label class="toggle-row">
                <input id="launchOnStartupInput" type="checkbox" />
                <span>开机启动</span>
              </label>
              <label class="toggle-row">
                <input id="silentStartupInput" type="checkbox" />
                <span>静默启动</span>
              </label>
            </div>
          </section>

          <section class="settings-section">
            <h4>Agent 路径</h4>
            <div class="path-settings">
              <label>
                Codex 路径
                <input id="codexSessionsDirInput" type="text" placeholder="~/.codex/sessions" />
              </label>
              <label>
                Claude 路径
                <input id="claudeSessionsDirInput" type="text" placeholder="~/.claude/projects" />
              </label>
              <label>
                OpenClaw 路径
                <input id="openclawSessionsDirInput" type="text" placeholder="~/.openclaw/agents" />
              </label>
              <label>
                OpenCode 路径
                <input id="opencodeSessionsDirInput" type="text" placeholder="~/.local/share/opencode/storage/message" />
              </label>
            </div>
          </section>
        </div>
      </section>
    </main>
  `;
}

const root = document.querySelector<HTMLElement>(viewMode === "pet" ? ".pet-root" : ".manager-root")!;
const treeImage = document.querySelector<HTMLImageElement>("#treeImage");
const previewTreeImage = document.querySelector<HTMLImageElement>("#previewTreeImage");
const weatherBack = document.querySelector<HTMLElement>("#weatherBack");
const weatherFront = document.querySelector<HTMLElement>("#weatherFront");
const previewWeatherBack = document.querySelector<HTMLElement>("#previewWeatherBack");
const previewWeatherFront = document.querySelector<HTMLElement>("#previewWeatherFront");
const petLevelBadge = document.querySelector<HTMLElement>("#petLevelBadge");
const previewLevelBadge = document.querySelector<HTMLElement>("#previewLevelBadge");
const lockInput = document.querySelector<HTMLInputElement>("#lockInput");
const settingsButton = document.querySelector<HTMLButtonElement>("#settingsButton");
const settingsCloseButton = document.querySelector<HTMLButtonElement>("#settingsCloseButton");
const settingsBackdrop = document.querySelector<HTMLElement>("#settingsBackdrop");
const settingsModal = document.querySelector<HTMLElement>("#settingsModal");
const scaleSelect = document.querySelector<HTMLSelectElement>("#scaleSelect");
const launchOnStartupInput = document.querySelector<HTMLInputElement>("#launchOnStartupInput");
const silentStartupInput = document.querySelector<HTMLInputElement>("#silentStartupInput");
const badgeFrontMetricSelect = document.querySelector<HTMLSelectElement>("#badgeFrontMetricSelect");
const badgeBackMetricSelect = document.querySelector<HTMLSelectElement>("#badgeBackMetricSelect");
const totalDisplayUnitSelect = document.querySelector<HTMLSelectElement>("#totalDisplayUnitSelect");
const codexSessionsDirInput = document.querySelector<HTMLInputElement>("#codexSessionsDirInput");
const claudeSessionsDirInput = document.querySelector<HTMLInputElement>("#claudeSessionsDirInput");
const openclawSessionsDirInput = document.querySelector<HTMLInputElement>("#openclawSessionsDirInput");
const opencodeSessionsDirInput = document.querySelector<HTMLInputElement>("#opencodeSessionsDirInput");

if (viewMode === "manager") {
  setupHistoryCard();
}

const historyBars = document.querySelector<HTMLElement>("#historyBars");
const historyTabs = document.querySelector<HTMLElement>("#historyTabs");
const historyLegend = document.querySelector<HTMLElement>("#historyLegend");
const sourceBreakdownElement = document.querySelector<HTMLElement>("#sourceBreakdown");

function setupHistoryCard() {
  const card = document.querySelector<HTMLElement>(".chart-card");
  if (!card) return;
  card.innerHTML = `
    <div class="chart-top">
      <div>
        <h3>最近 7 天</h3>
        <span id="historySummary">全部来源</span>
      </div>
      <div class="history-tabs" id="historyTabs" role="tablist" aria-label="最近 7 天来源">
        <button type="button" data-history-filter="all">全部</button>
        <button type="button" data-history-filter="codex">Codex</button>
        <button type="button" data-history-filter="openclaw">OpenClaw</button>
        <button type="button" data-history-filter="opencode">OpenCode</button>
        <button type="button" data-history-filter="claude">Claude Code</button>
      </div>
    </div>
    <div class="history-legend" id="historyLegend" aria-label="token 类型">
      <span><i class="legend-input"></i>input</span>
      <span><i class="legend-output"></i>output</span>
      <span><i class="legend-cache-read"></i>cache hit</span>
      <span><i class="legend-cache-write"></i>cache write</span>
    </div>
    <div class="history-bars" id="historyBars" aria-label="最近 7 天 XP"></div>
  `;
}

async function boot() {
  const [manifest, balance] = await Promise.all([
    fetch(assetUrl("/assets/trees/vibe-bonsai/config/pure-svg-manifest.json")).then(
      (res) => res.json() as Promise<PureSvgManifest>,
    ),
    fetch(assetUrl("/assets/trees/vibe-bonsai/config/game-balance.json")).then(
      (res) => res.json() as Promise<GameBalance>,
    ),
  ]);
  tree = buildTreeAsset(manifest);
  gameBalance = balance;
  ledger = await window.bonsai.getLedger();
  usageStatus = await window.bonsai.getUsageStatus();

  bindEvents();
  render();
  setInterval(render, 1_000);
  startAutoBadgeFlipLoop();

  window.bonsai.onLedger((nextLedger) => {
    ledger = nextLedger;
    render();
  });
  window.bonsai.onUsageStatus((nextStatus) => {
    usageStatus = nextStatus;
    renderUsageStatus();
  });
}

function bindEvents() {
  if (viewMode === "pet") {
    const petStage = document.querySelector<HTMLElement>("#petStage")!;
    const petHitbox = document.querySelector<HTMLButtonElement>("#petHitbox")!;
    petLevelBadge?.addEventListener("pointerenter", () => {
      flipLevelBadgeTemporarily("#petLevelBadge");
    });
    petLevelBadge?.addEventListener("dblclick", () => {
      void window.bonsai.setExpanded(true);
    });

    petHitbox.addEventListener("dblclick", () => {
      void window.bonsai.setExpanded(true);
    });

    petStage.addEventListener("mousedown", async (event) => {
      if (event.button !== 0 || ledger?.settings.locked) return;
      const startBounds = await window.bonsai.getWindowBounds();
      if (!startBounds) return;
      dragState = {
        startMouse: { x: event.screenX, y: event.screenY },
        startBounds,
      };
    });

    window.addEventListener("mousemove", async (event) => {
      if (!dragState) return;
      const dx = event.screenX - dragState.startMouse.x;
      const dy = event.screenY - dragState.startMouse.y;
      await window.bonsai.setWindowPosition({
        x: dragState.startBounds.x + dx,
        y: dragState.startBounds.y + dy,
      });
    });

    window.addEventListener("mouseup", async () => {
      if (!dragState) return;
      dragState = null;
      await window.bonsai.persistWindowPosition();
    });
  } else {
    previewLevelBadge?.addEventListener("pointerenter", () => {
      flipLevelBadgeTemporarily("#previewLevelBadge");
    });
  }

  lockInput?.addEventListener("change", async () => {
    if (!ledger) return;
    ledger = await window.bonsai.updateSettings({ locked: lockInput.checked });
    render();
  });

  settingsButton?.addEventListener("click", () => {
    setSettingsOpen(true);
  });

  settingsCloseButton?.addEventListener("click", () => {
    setSettingsOpen(false);
  });

  settingsBackdrop?.addEventListener("click", () => {
    setSettingsOpen(false);
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setSettingsOpen(false);
  });

  scaleSelect?.addEventListener("change", async () => {
    if (!ledger) return;
    ledger = await window.bonsai.updateSettings({ scale: Number(scaleSelect.value) });
    render();
  });

  launchOnStartupInput?.addEventListener("change", async () => {
    if (!ledger) return;
    ledger = await window.bonsai.updateSettings({ launchOnStartup: launchOnStartupInput.checked });
    render();
  });

  silentStartupInput?.addEventListener("change", async () => {
    if (!ledger) return;
    ledger = await window.bonsai.updateSettings({ silentStartup: silentStartupInput.checked });
    render();
  });

  badgeFrontMetricSelect?.addEventListener("change", async () => {
    if (!ledger) return;
    ledger = await window.bonsai.updateSettings({
      badgeFrontMetric: normalizeBadgeMetric(badgeFrontMetricSelect.value, "level"),
    });
    render();
  });

  badgeBackMetricSelect?.addEventListener("change", async () => {
    if (!ledger) return;
    ledger = await window.bonsai.updateSettings({
      badgeBackMetric: normalizeBadgeMetric(badgeBackMetricSelect.value, "total"),
    });
    render();
  });

  totalDisplayUnitSelect?.addEventListener("change", async () => {
    if (!ledger) return;
    ledger = await window.bonsai.updateSettings({
      totalDisplayUnit: normalizeTotalDisplayUnit(totalDisplayUnitSelect.value),
    });
    render();
  });

  codexSessionsDirInput?.addEventListener("change", () => updatePathSetting("codexSessionsDir", codexSessionsDirInput));
  claudeSessionsDirInput?.addEventListener("change", () =>
    updatePathSetting("claudeSessionsDir", claudeSessionsDirInput),
  );
  openclawSessionsDirInput?.addEventListener("change", () =>
    updatePathSetting("openclawSessionsDir", openclawSessionsDirInput),
  );
  opencodeSessionsDirInput?.addEventListener("change", () =>
    updatePathSetting("opencodeSessionsDir", opencodeSessionsDirInput),
  );

  historyTabs?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-history-filter]");
    if (!button) return;
    const nextFilter = button.dataset.historyFilter as HistoryFilter | undefined;
    if (!nextFilter || nextFilter === historyFilter) return;
    historyFilter = nextFilter;
    render();
  });

  sourceBreakdownElement?.addEventListener("click", (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-source-key]");
    if (!row || !ledger) return;
    const sourceKey = row.dataset.sourceKey;
    if (!sourceKey) return;
    expandedSourceKey = expandedSourceKey === sourceKey ? null : sourceKey;
    renderSourceBreakdown(getSourceBreakdown(ledger.entries));
  });

}

async function updatePathSetting(
  key: "codexSessionsDir" | "claudeSessionsDir" | "openclawSessionsDir" | "opencodeSessionsDir",
  input: HTMLInputElement,
) {
  if (!ledger) return;
  const value = input.value.trim() || undefined;
  ledger = await window.bonsai.updateSettings({ [key]: value });
  render();
}

function setSettingsOpen(open: boolean) {
  if (!settingsModal) return;
  settingsModal.classList.toggle("open", open);
  settingsModal.setAttribute("aria-hidden", String(!open));
}

function render() {
  if (!ledger || !tree || !gameBalance) return;
  const stats = calculateStats(ledger.entries, tree, gameBalance);
  const leveledUp = lastRenderedLevel !== null && stats.level > lastRenderedLevel;
  if (leveledUp && lastRenderedLevel !== null) {
    pendingLevelUp = { from: lastRenderedLevel, to: stats.level };
  }
  lastRenderedLevel = stats.level;

  root.dataset.weather = stats.weather.id;
  root.dataset.locked = String(ledger.settings.locked);
  root.dataset.active = String(stats.recentXp > 0 || stats.weather.tokensPerMinute > 0);
  root.dataset.scale = String(ledger.settings.scale).replace(".", "-");
  root.dataset.stage = stats.stage.id;

  if (treeImage) {
    treeImage.src = assetUrl(stats.stage.image);
    treeImage.alt = `${tree.displayName} ${stats.stage.label}`;
  }
  if (previewTreeImage) {
    previewTreeImage.src = assetUrl(stats.stage.image);
    previewTreeImage.alt = `${tree.displayName} ${stats.stage.label}`;
  }

  renderLevelBadge(
    "#petLevelBadge",
    stats,
    ledger.settings.badgeFrontMetric,
    ledger.settings.badgeBackMetric,
    ledger.settings.totalDisplayUnit,
  );
  renderLevelBadge(
    "#previewLevelBadge",
    stats,
    ledger.settings.badgeFrontMetric,
    ledger.settings.badgeBackMetric,
    ledger.settings.totalDisplayUnit,
  );
  if (leveledUp) {
    flipLevelBadgeTemporarily("#petLevelBadge");
    flipLevelBadgeTemporarily("#previewLevelBadge");
  }
  text("#levelTitle", `Lv.${stats.level} ${stats.stage.label}`);
  text("#weatherLabel", stats.weather.label);
  text("#weatherRateText", `${formatNumber(stats.weather.tokensPerMinute)} XP/min`);
  text("#totalText", formatNumber(stats.xp));
  text("#todayText", `+${formatNumber(stats.todayXp)}`);
  text("#activeSessionsText", stats.activeSessions ? `${stats.activeSessions} 个` : "0");
  text("#peakText", `5 分钟 +${formatNumber(stats.lastFiveMinuteXp)} XP`);
  text("#nextLevelText", `距离 Lv.${stats.level + 1}`);
  text("#progressText", `${formatNumber(stats.levelXp)} / ${formatNumber(stats.nextLevelXp)} XP`);
  renderSourceBreakdown(stats.sourceBreakdown);

  const progressBar = document.querySelector<HTMLElement>("#progressBar");
  if (progressBar) progressBar.style.width = `${stats.levelProgress * 100}%`;
  if (lockInput) lockInput.checked = ledger.settings.locked;
  if (scaleSelect) scaleSelect.value = String(ledger.settings.scale);
  if (launchOnStartupInput) launchOnStartupInput.checked = ledger.settings.launchOnStartup;
  if (silentStartupInput) silentStartupInput.checked = ledger.settings.silentStartup;
  if (badgeFrontMetricSelect) badgeFrontMetricSelect.value = ledger.settings.badgeFrontMetric;
  if (badgeBackMetricSelect) badgeBackMetricSelect.value = ledger.settings.badgeBackMetric;
  if (totalDisplayUnitSelect) totalDisplayUnitSelect.value = ledger.settings.totalDisplayUnit;
  syncInputValue(codexSessionsDirInput, ledger.settings.codexSessionsDir ?? "");
  syncInputValue(claudeSessionsDirInput, ledger.settings.claudeSessionsDir ?? "");
  syncInputValue(openclawSessionsDirInput, ledger.settings.openclawSessionsDir ?? "");
  syncInputValue(opencodeSessionsDirInput, ledger.settings.opencodeSessionsDir ?? "");

  if (lastWeatherId !== stats.weather.id) {
    lastWeatherId = stats.weather.id;
    renderWeatherLayers(stats.weather.id);
  }
  if (pendingLevelUp) triggerLevelUpAnimation(pendingLevelUp);
  renderUsageStatus();
  renderHistoryChart(getSevenDayRows(ledger.entries, historyFilter), historyFilter);
}

function triggerLevelUpAnimation(levels: { from: number; to: number }) {
  text("#petLevelUpText", `Lv.${levels.from} -> Lv.${levels.to}`);
  text("#previewLevelUpText", `Lv.${levels.from} -> Lv.${levels.to}`);
  pendingLevelUp = null;
  root.classList.remove("level-up");
  void root.offsetWidth;
  root.classList.add("level-up");
  if (levelUpTimer) window.clearTimeout(levelUpTimer);
  levelUpTimer = window.setTimeout(() => {
    root.classList.remove("level-up");
    levelUpTimer = undefined;
  }, 2200);
}

function renderLevelBadge(
  selector: string,
  stats: Stats,
  frontMetric: BadgeMetric,
  backMetric: BadgeMetric,
  totalUnit: TotalDisplayUnit,
) {
  const badge = document.querySelector<HTMLElement>(selector);
  if (!badge) return;
  const front = badge.querySelector<HTMLElement>(".badge-front");
  const back = badge.querySelector<HTMLElement>(".badge-back");
  if (!front || !back) return;

  const frontText = badgeMetricText(frontMetric, stats, totalUnit);
  const backText = badgeMetricText(backMetric, stats, totalUnit);
  front.textContent = frontText;
  back.textContent = backText;
  badge.style.setProperty("--badge-front-width", `${badgeWidthForText(frontText)}px`);
  badge.style.setProperty("--badge-back-width", `${badgeWidthForText(backText)}px`);
}

function badgeMetricText(metric: BadgeMetric, stats: Stats, totalUnit: TotalDisplayUnit) {
  if (metric === "level") return `Lv.${stats.level}`;
  if (metric === "rate") return `${formatIntegerWithCommas(stats.weather.tokensPerMinute / 60)}/s`;
  return formatByUnit(stats.xp, totalUnit);
}

function badgeWidthForText(...values: string[]) {
  const longest = Math.max(...values.map((value) => value.length));
  return clamp(54 + Math.max(0, longest - 5) * 7, 54, 132);
}

function startAutoBadgeFlipLoop() {
  if (badgeAutoFlipTimer) return;
  const selector = viewMode === "pet" ? "#petLevelBadge" : "#previewLevelBadge";
  badgeAutoFlipTimer = window.setInterval(() => {
    flipLevelBadgeTemporarily(selector);
  }, AUTO_BADGE_FLIP_MS);
}

function flipLevelBadgeTemporarily(selector: string) {
  const badge = document.querySelector<HTMLElement>(selector);
  if (!badge || badgeFlipTimers.has(selector)) return;

  badge.classList.add("level-badge-show-total");
  const timer = window.setTimeout(() => {
    badge.classList.remove("level-badge-show-total");
    badgeFlipTimers.delete(selector);
  }, BADGE_TOKEN_HOLD_MS);
  badgeFlipTimers.set(selector, timer);
}

function renderWeatherLayers(weather: WeatherId) {
  const back = weatherBackHtml(weather);
  const front = weatherFrontHtml(weather);
  if (weatherBack) weatherBack.innerHTML = back;
  if (weatherFront) weatherFront.innerHTML = front;
  if (previewWeatherBack) previewWeatherBack.innerHTML = back;
  if (previewWeatherFront) previewWeatherFront.innerHTML = front;
}

function renderUsageStatus() {
  if (!usageStatus) return;
  if (ledger) {
    renderSourceBreakdown(getSourceBreakdown(ledger.entries));
  }
  const codexEntries = ledger?.entries.filter((entry) => entry.source === "codex-session").length ?? 0;
  const claudeEntries = ledger?.entries.filter((entry) => entry.source === "claude-session").length ?? 0;
  const openclawEntries = ledger?.entries.filter((entry) => entry.source === "openclaw-session").length ?? 0;
  const opencodeEntries = ledger?.entries.filter((entry) => entry.source === "opencode-session").length ?? 0;
  const activeSources = [codexEntries > 0, claudeEntries > 0, openclawEntries > 0, opencodeEntries > 0].filter(
    Boolean,
  ).length;
  text("#sourceSummary", activeSources ? `${activeSources} 个来源有记录` : "等待 token");
}

function renderSourceBreakdown(rows: SourceBreakdown[]) {
  const element = document.querySelector<HTMLElement>("#sourceBreakdown");
  if (!element) return;
  const totalXp = rows.reduce((total, row) => total + row.xp, 0);
  element.innerHTML = getMonitorSourceRows(rows)
    .map((row) => {
      const percent = row.xp > 0 && totalXp > 0 ? Math.max(3, Math.round((row.xp / totalXp) * 100)) : 0;
      const expanded = expandedSourceKey === row.sourceKey;
      return `
        <article class="source-row ${expanded ? "expanded" : ""}" data-source-key="${escapeHtml(row.sourceKey)}" aria-expanded="${expanded}">
          <div class="source-main">
            <div>
              <strong>${escapeHtml(row.label)}</strong>
              <span class="source-meta">${escapeHtml(row.meta)}</span>
            </div>
            <span class="source-status ${row.statusClass}">${escapeHtml(row.status)}</span>
          </div>
          <div class="source-usage">
            <div>
              <strong>${formatCompact(row.xp)} XP</strong>
              <span>${row.xp > 0 ? `${percent}%` : "无记录"}</span>
            </div>
            <div class="source-meter"><span style="width:${percent}%"></span></div>
            <p>in ${formatCompact(row.inputTokens)} · out ${formatCompact(row.outputTokens)} · cache ${formatCompact(row.cacheReadTokens)}</p>
          </div>
          ${expanded ? renderModelBreakdown(row.sourceKey) : ""}
        </article>
      `;
    })
    .join("");
}

type SourceRowView = SourceBreakdown & {
  sourceKey: string;
  status: string;
  statusClass: string;
  meta: string;
};

function getMonitorSourceRows(rows: SourceBreakdown[]): SourceRowView[] {
  const monitors = [
    {
      sourceKey: "codex",
      label: "Codex",
      status: usageStatus?.codexSession,
      match: (row: SourceBreakdown) => row.id === "codex-desktop" || row.id === "codex-session" || row.label === "Codex",
    },
    {
      sourceKey: "claude",
      label: "Claude Code",
      status: usageStatus?.claudeSession,
      match: (row: SourceBreakdown) =>
        row.id === "claude-code" ||
        row.id === "claude-session" ||
        row.label === "Claude Code" ||
        row.id.startsWith("claude-code:"),
    },
    {
      sourceKey: "openclaw",
      label: "OpenClaw",
      status: usageStatus?.openclawSession,
      match: (row: SourceBreakdown) => row.id === "openclaw" || row.id === "openclaw-session" || row.label === "OpenClaw",
    },
    {
      sourceKey: "opencode",
      label: "OpenCode",
      status: usageStatus?.opencodeSession,
      match: (row: SourceBreakdown) =>
        row.id === "opencode" || row.id === "opencode-session" || row.label === "OpenCode" || row.id.startsWith("opencode:"),
    },
  ];
  const used = new Set<SourceBreakdown>();
  const monitorRows = monitors.map((monitor) => {
    const matches = rows.filter((row) => monitor.match(row));
    matches.forEach((row) => used.add(row));
    return {
      ...combineSourceRows(monitor.label, matches),
      sourceKey: monitor.sourceKey,
      ...monitorStatusView(monitor.status),
    };
  });
  return monitorRows;
}

function combineSourceRows(label: string, rows: SourceBreakdown[]): SourceBreakdown {
  return rows.reduce(
    (total, row) => ({
      ...total,
      xp: total.xp + row.xp,
      inputTokens: total.inputTokens + row.inputTokens,
      outputTokens: total.outputTokens + row.outputTokens,
      cacheReadTokens: total.cacheReadTokens + row.cacheReadTokens,
      cacheWriteTokens: total.cacheWriteTokens + row.cacheWriteTokens,
    }),
    { id: label, label, xp: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  );
}

function monitorStatusView(status: UsageStatus["codexSession"] | undefined) {
  if (!status) return { status: "检查中", statusClass: "pending", meta: "正在读取本机记录" };
  const running = status.exists && status.running;
  return {
    status: running ? "在线" : "离线",
    statusClass: running ? "running" : "missing",
    meta: `${status.filesWatched} 个文件 · ${status.lastEventAt ? formatRelativeTime(status.lastEventAt) : "等待新 token"}`,
  };
}

function renderModelBreakdown(sourceKey: string) {
  const rows = getModelBreakdown(sourceKey);
  if (!rows.length) {
    return `<div class="model-breakdown empty">还没有模型记录</div>`;
  }
  const totalXp = rows.reduce((total, row) => total + row.xp, 0);
  return `
    <div class="model-breakdown">
      <div class="model-breakdown-title">模型占比</div>
      ${rows
        .map((row) => {
          const percent = row.xp > 0 && totalXp > 0 ? Math.max(3, Math.round((row.xp / totalXp) * 100)) : 0;
          return `
            <div class="model-row">
              <div>
                <strong>${escapeHtml(row.label)}</strong>
                <span>${formatCompact(row.xp)} XP · ${percent}%</span>
              </div>
              <div class="source-meter"><span style="width:${percent}%"></span></div>
              <p>in ${formatCompact(row.inputTokens)} · out ${formatCompact(row.outputTokens)} · cache ${formatCompact(row.cacheReadTokens)}</p>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function getModelBreakdown(sourceKey: string) {
  if (!ledger) return [];
  const rows = new Map<string, SourceBreakdown>();
  for (const entry of ledger.entries) {
    if (!entryMatchesSourceKey(entry, sourceKey)) continue;
    const model = entry.model || entry.provider || "unknown";
    const existing =
      rows.get(model) ??
      {
        id: model,
        label: model,
        xp: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      };
    existing.xp += xpForEntry(entry);
    existing.inputTokens += safeTokens(entry.inputTokens ?? 0);
    existing.outputTokens += safeTokens(entry.outputTokens ?? 0);
    existing.cacheReadTokens += safeTokens(entry.cacheReadTokens ?? 0);
    existing.cacheWriteTokens += safeTokens(entry.cacheWriteTokens ?? 0);
    rows.set(model, existing);
  }
  return [...rows.values()].filter((row) => row.xp > 0).sort((a, b) => b.xp - a.xp);
}

function entryMatchesSourceKey(entry: LedgerEntry, sourceKey: string) {
  if (sourceKey === "codex") return entry.source === "codex-session" || entry.agent === "codex-desktop";
  if (sourceKey === "claude") return entry.source === "claude-session" || Boolean(entry.agent?.startsWith("claude-code"));
  if (sourceKey === "openclaw") return entry.source === "openclaw-session" || entry.agent === "openclaw";
  if (sourceKey === "opencode") {
    return entry.source === "opencode-session" || entry.agent === "opencode" || Boolean(entry.agent?.startsWith("opencode:"));
  }
  if (sourceKey.startsWith("source:")) {
    const id = sourceKey.slice("source:".length);
    const entryId = entry.source === "manual" ? "manual" : entry.agent || entry.source;
    return entryId === id;
  }
  return false;
}

function buildTreeAsset(manifest: PureSvgManifest): TreeAsset {
  const labels: Record<string, string> = {
    sprout: "新芽",
    seedling: "幼苗",
    young: "小树",
    medium: "成长期",
    lush: "茂盛",
    full: "完全体",
  };

  return {
    id: "vibe-bonsai",
    displayName: "Vibe Tree",
    baseSize: { width: 96, height: 96 },
    defaultScale: 2,
    palette: {
      leaf: "#5bbf7a",
      rain: "#78b7d8",
      storm: "#fff2a8",
      soilGlow: "#f2a541",
      wind: "#d7f7d0",
    },
    stages: manifest.stages.map((stage) => ({
      id: stage.id,
      label: labels[stage.id] ?? stage.label,
      image: stage.asset,
    })),
  };
}

function calculateStats(entries: LedgerEntry[], asset: TreeAsset, balance: GameBalance): Stats {
  const now = Date.now();
  const peakWindowAgo = now - balance.activity.peakWindowSeconds * 1000;
  const activeWindowAgo = now - balance.activity.activeWindowSeconds * 1000;
  const todayKey = dateKey(new Date());
  const xp = entries.reduce((total, entry) => total + xpForEntry(entry), 0);
  const todayXp = entries
    .filter((entry) => dateKey(new Date(entry.createdAt)) === todayKey)
    .reduce((total, entry) => total + xpForEntry(entry), 0);
  const lastFiveMinuteXp = entries
    .filter((entry) => new Date(entry.createdAt).getTime() >= peakWindowAgo)
    .reduce((total, entry) => total + xpForEntry(entry), 0);
  const recentXp = entries
    .filter((entry) => new Date(entry.createdAt).getTime() >= activeWindowAgo)
    .reduce((total, entry) => total + xpForEntry(entry), 0);
  const activeSessions = getActiveSessionCount(entries, activeWindowAgo);
  const levelState = getLevelState(xp, balance);
  const stageInfo = getStageForLevel(levelState.level, balance);
  const stage = asset.stages.find((item) => item.id === stageInfo.id) ?? asset.stages[0];
  const nextStage = getNextStageForLevel(levelState.level, balance);
  const stageProgress = getStageProgress(levelState.level, balance);
  const weather = getWeather(getWeatherRate(entries, now, balance), balance);

  return {
    xp,
    todayXp,
    level: levelState.level,
    levelXp: levelState.levelXp,
    nextLevelXp: levelState.nextLevelXp,
    levelProgress: levelState.progress,
    stage,
    nextStageLabel: nextStage?.label,
    stageProgress,
    weather,
    lastFiveMinuteXp,
    recentXp,
    activeSessions,
    sevenDays: getSevenDayRows(entries),
    sourceBreakdown: getSourceBreakdown(entries),
  };
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

function getWeatherRate(entries: LedgerEntry[], now: number, balance: GameBalance) {
  const recentTokens = getWindowXp(entries, now, balance.weather.rateWindowSeconds);
  return (recentTokens / balance.weather.rateWindowSeconds) * 60;
}

function getWindowXp(entries: LedgerEntry[], now: number, seconds: number) {
  return entries.reduce((total, entry) => {
    const ageSeconds = Math.max(0, (now - new Date(entry.createdAt).getTime()) / 1000);
    if (ageSeconds > seconds) return total;
    return total + xpForEntry(entry);
  }, 0);
}

function getActiveSessionCount(entries: LedgerEntry[], since: number) {
  const sessions = new Set<string>();
  for (const entry of entries) {
    if (new Date(entry.createdAt).getTime() < since) continue;
    if (xpForEntry(entry) <= 0) continue;
    sessions.add(entry.agent || entry.source);
  }
  return sessions.size;
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

function getSevenDayRows(entries: LedgerEntry[], filter: HistoryFilter = "all") {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    const key = dateKey(date);
    const dayEntries = entries.filter(
      (entry) => sourceMatchesHistoryFilter(entry, filter) && dateKey(new Date(entry.createdAt)) === key,
    );
    const inputTokens = dayEntries.reduce((total, entry) => total + safeTokens(entry.inputTokens ?? 0), 0);
    const outputTokens = dayEntries.reduce((total, entry) => total + safeTokens(entry.outputTokens ?? 0), 0);
    const cacheReadTokens = dayEntries.reduce((total, entry) => total + safeTokens(entry.cacheReadTokens ?? 0), 0);
    const cacheWriteTokens = dayEntries.reduce((total, entry) => total + safeTokens(entry.cacheWriteTokens ?? 0), 0);
    const tokens = dayEntries.reduce((total, entry) => total + xpForEntry(entry), 0);
    const sources: Record<HistorySourceId, number> = { codex: 0, openclaw: 0, opencode: 0, claude: 0 };
    for (const entry of dayEntries) {
      const source = historySourceId(entry);
      if (source) sources[source] += xpForEntry(entry);
    }
    return {
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      tokens,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      sources,
    };
  });
}

function historySourceId(entry: LedgerEntry): HistorySourceId | undefined {
  if (entry.source === "codex-session" || entry.agent === "codex-desktop") return "codex";
  if (entry.source === "openclaw-session" || entry.agent === "openclaw") return "openclaw";
  if (entry.source === "opencode-session" || entry.agent === "opencode" || Boolean(entry.agent?.startsWith("opencode:"))) {
    return "opencode";
  }
  if (entry.source === "claude-session" || Boolean(entry.agent?.startsWith("claude-code"))) return "claude";
  return undefined;
}

function sourceMatchesHistoryFilter(entry: LedgerEntry, filter: HistoryFilter) {
  if (filter === "all") return true;
  if (filter === "codex") {
    return entry.source === "codex-session" || entry.agent === "codex-desktop";
  }
  if (filter === "openclaw") {
    return entry.source === "openclaw-session" || entry.agent === "openclaw";
  }
  if (filter === "opencode") {
    return entry.source === "opencode-session" || entry.agent === "opencode" || Boolean(entry.agent?.startsWith("opencode:"));
  }
  return entry.source === "claude-session" || Boolean(entry.agent?.startsWith("claude-code"));
}

function getSourceBreakdown(entries: LedgerEntry[]): SourceBreakdown[] {
  const rows = new Map<string, SourceBreakdown>();
  for (const entry of entries) {
    const id = entry.source === "manual" ? "manual" : entry.agent || entry.source;
    const existing =
      rows.get(id) ??
      {
        id,
        label: sourceLabel(id, entry.source),
        xp: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      };
    const inputTokens = safeTokens(entry.inputTokens ?? 0);
    const outputTokens = safeTokens(entry.outputTokens ?? 0);
    existing.inputTokens += inputTokens;
    existing.outputTokens += outputTokens;
    existing.cacheReadTokens += safeTokens(entry.cacheReadTokens ?? 0);
    existing.cacheWriteTokens += safeTokens(entry.cacheWriteTokens ?? 0);
    existing.xp += xpForEntry(entry);
    rows.set(id, existing);
  }
  return [...rows.values()].sort((a, b) => b.xp - a.xp);
}

function sourceLabel(id: string, source: string) {
  if (source === "manual") return "手动喂养";
  if (id.startsWith("claude-code:")) return `Claude ${id.replace("claude-code:", "")}`;
  if (id === "claude-code" || source === "claude-session") return "Claude Code";
  if (id === "codex-desktop" || source === "codex-session") return "Codex";
  if (id === "openclaw" || source === "openclaw-session") return "OpenClaw";
  if (id.startsWith("opencode:")) return `OpenCode ${id.replace("opencode:", "")}`;
  if (id === "opencode" || source === "opencode-session") return "OpenCode";
  return id;
}

function renderHistoryChart(rows: HistoryDayRow[], filter: HistoryFilter) {
  const labels: Record<HistoryFilter, string> = {
    all: "全部来源",
    codex: "Codex",
    openclaw: "OpenClaw",
    opencode: "OpenCode",
    claude: "Claude Code",
  };
  const total = rows.reduce((sum, row) => sum + row.tokens, 0);
  const max =
    filter === "all"
      ? Math.max(1, ...rows.map((row) => row.tokens))
      : Math.max(1, ...rows.map((row) => row.tokens + row.cacheReadTokens + row.cacheWriteTokens));

  text("#historySummary", `${labels[filter]} · ${formatCompact(total)} XP`);
  if (historyLegend) historyLegend.innerHTML = filter === "all" ? historyAgentLegendHtml() : historyTokenLegendHtml();

  historyTabs?.querySelectorAll<HTMLButtonElement>("[data-history-filter]").forEach((button) => {
    const active = button.dataset.historyFilter === filter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });

  if (!historyBars) return;
  historyBars.innerHTML = rows
    .map((row) => {
      const fullTokens = filter === "all" ? row.tokens : row.tokens + row.cacheReadTokens + row.cacheWriteTokens;
      const height = fullTokens > 0 ? Math.max(8, Math.round((fullTokens / max) * 100)) : 0;
      const segments =
        filter === "all"
          ? `
              <span class="history-segment codex" style="height:${segmentPercent(row.sources.codex, fullTokens)}%"></span>
              <span class="history-segment openclaw" style="height:${segmentPercent(row.sources.openclaw, fullTokens)}%"></span>
              <span class="history-segment opencode" style="height:${segmentPercent(row.sources.opencode, fullTokens)}%"></span>
              <span class="history-segment claude" style="height:${segmentPercent(row.sources.claude, fullTokens)}%"></span>
            `
          : `
              <span class="history-segment input" style="height:${segmentPercent(row.inputTokens, fullTokens)}%"></span>
              <span class="history-segment output" style="height:${segmentPercent(row.outputTokens, fullTokens)}%"></span>
              <span class="history-segment cache-read" style="height:${segmentPercent(row.cacheReadTokens, fullTokens)}%"></span>
              <span class="history-segment cache-write" style="height:${segmentPercent(row.cacheWriteTokens, fullTokens)}%"></span>
            `;
      const title =
        filter === "all"
          ? `Codex ${formatCompact(row.sources.codex)} · OpenClaw ${formatCompact(row.sources.openclaw)} · OpenCode ${formatCompact(row.sources.opencode)} · Claude ${formatCompact(row.sources.claude)}`
          : `input ${formatCompact(row.inputTokens)} · output ${formatCompact(row.outputTokens)} · cache hit ${formatCompact(row.cacheReadTokens)} · cache write ${formatCompact(row.cacheWriteTokens)}`;
      return `
        <article class="history-day">
          <div class="history-bar-shell" title="${title}">
            <div class="history-stack" style="height:${height}%">
              ${segments}
            </div>
          </div>
          <strong>${formatCompact(row.tokens)}</strong>
          <span>${row.label}</span>
        </article>
      `;
    })
    .join("");
}

function historyTokenLegendHtml() {
  return `
    <span><i class="legend-input"></i>input</span>
    <span><i class="legend-output"></i>output</span>
    <span><i class="legend-cache-read"></i>cache hit</span>
    <span><i class="legend-cache-write"></i>cache write</span>
  `;
}

function historyAgentLegendHtml() {
  return `
    <span><i class="legend-codex"></i>Codex</span>
    <span><i class="legend-openclaw"></i>OpenClaw</span>
    <span><i class="legend-opencode"></i>OpenCode</span>
    <span><i class="legend-claude"></i>Claude Code</span>
  `;
}

function segmentPercent(value: number, total: number) {
  if (value <= 0 || total <= 0) return 0;
  return Math.max(4, Math.round((value / total) * 100));
}

function xpForEntry(entry: LedgerEntry) {
  if (
    entry.inputTokens === undefined &&
    entry.outputTokens === undefined &&
    entry.cacheReadTokens === undefined &&
    entry.cacheWriteTokens === undefined
  ) {
    return safeTokens(entry.tokens);
  }

  return safeTokens(entry.inputTokens ?? 0) + safeTokens(entry.outputTokens ?? 0);
}

function safeTokens(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function normalizeBadgeMetric(value: string, fallback: BadgeMetric): BadgeMetric {
  return value === "level" || value === "total" || value === "rate" ? value : fallback;
}

function normalizeTotalDisplayUnit(value: string): TotalDisplayUnit {
  return value === "k" || value === "m" ? value : "m";
}

function formatByUnit(value: number, unit: TotalDisplayUnit) {
  const divisor = unit === "m" ? 1_000_000 : 1_000;
  return `${formatIntegerWithCommas(Math.round(Math.max(0, value) / divisor))}${unit}`;
}

function formatIntegerWithCommas(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(value));
}

function weatherBackHtml(weather: WeatherId) {
  if (weather === "drizzle") {
    return `<svg class="weather-svg behind" viewBox="0 0 192 192">${cloud(118, 34, false, "small")}</svg>`;
  }
  if (weather === "rain") {
    return `<svg class="weather-svg behind" viewBox="0 0 192 192">${cloud(56, 34, false, "medium")}</svg>`;
  }
  if (weather === "thunder" || weather === "storm") {
    return `<svg class="weather-svg behind" viewBox="0 0 192 192">${cloud(weather === "storm" ? 102 : 104, weather === "storm" ? 32 : 30, true, weather === "storm" ? "wide" : "thunder")}</svg>`;
  }
  return "";
}

function weatherFrontHtml(weather: WeatherId) {
  if (weather === "clear") {
    return `
      <svg class="weather-svg" viewBox="0 0 192 192">
        <g class="sun">${sunIcon(34, 34)}</g>
        <g class="spark-a">${tinySpark(36, 108)}${tinySpark(82, 84)}</g>
        <g class="spark-b">${tinySpark(146, 98)}</g>
      </svg>
    `;
  }
  if (weather === "breeze") {
    return `
      <svg class="weather-svg" viewBox="0 0 192 192">
        <g class="wind-a">${windLine(118, 68, 24)}${windLine(110, 84, 30)}</g>
        <g class="wind-b">${windLine(124, 100, 22)}${leafBit(76, 96)}${leafBit(132, 94)}</g>
      </svg>
    `;
  }
  if (weather === "drizzle") {
    return `<svg class="weather-svg" viewBox="0 0 192 192"><g class="rain-slow">${drop(114, 56)}${drop(134, 68)}${drop(152, 86)}${drop(150, 116)}</g></svg>`;
  }
  if (weather === "rain") {
    return `
      <svg class="weather-svg" viewBox="0 0 192 192">
        <g class="rain-slow">${drop(52, 72)}${drop(74, 66)}${drop(112, 68)}${drop(136, 76)}</g>
        <g class="rain-fast">${drop(48, 102)}${drop(88, 94)}${drop(126, 102)}${drop(148, 116)}</g>
        <g class="puddle">${puddle(72, 140)}${puddle(116, 142)}</g>
      </svg>
    `;
  }
  if (weather === "thunder") {
    return `
      <svg class="weather-svg" viewBox="0 0 192 192">
        <g class="rain-slow">${drop(52, 72)}${drop(74, 66)}${drop(112, 68)}${drop(136, 76)}</g>
        <g class="rain-fast">${drop(48, 102)}${drop(88, 94)}${drop(126, 102)}${drop(148, 116)}</g>
        <g class="puddle">${puddle(72, 140)}${puddle(116, 142)}</g>
        <g class="bolt">${boltIcon(132, 58)}</g>
      </svg>
    `;
  }
  if (weather === "storm") {
    return `
      <svg class="weather-svg" viewBox="0 0 192 192">
        <g class="rain-slant">${slantDrop(76, 70)}${slantDrop(100, 66)}${slantDrop(124, 72)}${slantDrop(146, 84)}${slantDrop(154, 104)}</g>
        <g class="wind-a">${windLine(56, 112, 28)}${windLine(52, 128, 22)}</g>
        <g class="wind-b">${windLine(112, 124, 30)}${leafBit(150, 92)}</g>
        <g class="puddle">${puddle(72, 140)}${puddle(116, 142)}</g>
      </svg>
    `;
  }
  return "";
}

function px(x: number, y: number, w: number, h: number, fill: string) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
}

function tinySpark(x: number, y: number) {
  return `${px(x, y + 4, 10, 4, "#ffd239")}${px(x + 3, y, 4, 12, "#ffd239")}`;
}

function sunIcon(x: number, y: number) {
  return `
    ${px(x, y, 17, 17, "#ffd239")}
    ${px(x + 5, y - 8, 5, 5, "#ffc928")}
    ${px(x + 5, y + 20, 5, 5, "#ffc928")}
    ${px(x - 8, y + 6, 5, 5, "#ffc928")}
    ${px(x + 20, y + 6, 5, 5, "#ffc928")}
    ${px(x + 4, y + 4, 8, 8, "#fff07a")}
  `;
}

function windLine(x: number, y: number, w: number) {
  return px(x, y, w, 4, "#b9e8f4");
}

function leafBit(x: number, y: number) {
  return px(x, y, 5, 5, "#83b93c");
}

function drop(x: number, y: number) {
  return px(x, y, 4, 14, "#86cbed");
}

function slantDrop(x: number, y: number) {
  return `<rect x="${x}" y="${y}" width="4" height="18" fill="#86cbed" transform="rotate(28 ${x} ${y})"/>`;
}

function puddle(x: number, y: number) {
  return `${px(x, y, 15, 4, "#5dbde7")}${px(x + 3, y - 2, 7, 2, "#9fe4ff")}`;
}

function boltIcon(x: number, y: number) {
  return `
    <polygon points="${x + 10},${y} ${x + 24},${y} ${x + 16},${y + 20} ${x + 26},${y + 20} ${x + 2},${y + 52} ${x + 10},${y + 28} ${x},${y + 28}" fill="#070807"/>
    <polygon points="${x + 12},${y + 4} ${x + 20},${y + 4} ${x + 12},${y + 24} ${x + 22},${y + 24} ${x + 6},${y + 44} ${x + 12},${y + 24} ${x + 4},${y + 24}" fill="#ffc928"/>
    ${px(x + 13, y + 6, 5, 7, "#fff07a")}
  `;
}

function cloud(x: number, y: number, dark: boolean, size: "small" | "medium" | "wide" | "thunder") {
  const main = dark ? "#66707a" : "#aebfca";
  const mid = dark ? "#505860" : "#7f929f";
  const hi = dark ? "#929ba3" : "#dfe9ee";
  const scale = size === "small" ? 0.72 : size === "wide" ? 0.92 : size === "thunder" ? 0.96 : 0.82;
  const sx = (value: number) => Math.round(value * scale);
  return `
    <g class="cloud" transform="translate(${x} ${y})">
      ${px(-sx(4), sx(22), sx(70), sx(18), "#070807")}
      ${px(sx(8), sx(10), sx(48), sx(24), "#070807")}
      ${px(sx(2), sx(24), sx(62), sx(12), main)}
      ${px(sx(14), sx(14), sx(40), sx(18), main)}
      ${px(sx(20), sx(14), sx(15), sx(6), hi)}
      ${px(sx(42), sx(24), sx(16), sx(8), mid)}
      ${px(sx(4), sx(32), sx(18), sx(8), mid)}
    </g>
  `;
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(Math.round(value));
}

function formatCompact(value: number) {
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  if (absolute < 1_000) return `${Math.round(value)}`;

  const units = [
    { value: 1_000_000_000, suffix: "b" },
    { value: 1_000_000, suffix: "m" },
    { value: 1_000, suffix: "k" },
  ];
  const unit = units.find((item) => absolute >= item.value);
  if (!unit) return `${Math.round(value)}`;

  const scaled = absolute / unit.value;
  const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  const formatted = scaled.toFixed(digits).replace(/\.0+$|(\.\d*[1-9])0+$/, "$1");
  return `${sign}${formatted}${unit.suffix}`;
}

function assetUrl(path: string) {
  if (location.protocol !== "file:" || !path.startsWith("/")) return path;
  return path.slice(1);
}

function formatRelativeTime(isoTime: string) {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(isoTime).getTime()) / 1000));
  if (elapsedSeconds < 5) return "刚刚";
  if (elapsedSeconds < 60) return `${elapsedSeconds} 秒前`;
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes} 分钟前`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  return `${elapsedHours} 小时前`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function text(selector: string, value: string) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
}

function syncInputValue(input: HTMLInputElement | null, value: string) {
  if (!input || document.activeElement === input) return;
  input.value = value;
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

boot().catch((error) => {
  console.error(error);
  app.innerHTML = `<pre class="fatal">${String(error)}</pre>`;
});
