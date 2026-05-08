import type { LedgerEntry, LedgerFile, TreeAsset, TreeStage, UsageStatus, WindowBounds } from "../shared/types";
import "./styles.css";

type WeatherId = "clear" | "breeze" | "drizzle" | "rain" | "thunder" | "storm";
type ViewMode = "pet" | "manager";
type HistoryFilter = "all" | "codex" | "openclaw" | "opencode" | "claude";

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
  sevenDays: Array<{ label: string; tokens: number }>;
  sourceBreakdown: SourceBreakdown[];
}

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

const viewMode: ViewMode = new URLSearchParams(location.search).get("view") === "manager" ? "manager" : "pet";
let ledger: LedgerFile | null = null;
let tree: TreeAsset | null = null;
let gameBalance: GameBalance | null = null;
let usageStatus: UsageStatus | null = null;
let lastWeatherId: WeatherId | null = null;
let historyFilter: HistoryFilter = "all";
let dragState: null | {
  startMouse: { x: number; y: number };
  startBounds: WindowBounds;
} = null;

if (viewMode === "pet") {
  app.innerHTML = `
    <main class="pet-root" data-locked="false" data-weather="clear" data-active="false">
      <section class="pet-stage" id="petStage" aria-label="Vibe Bonsai">
        <div class="weather-layer weather-back" id="weatherBack"></div>
        <div class="pet-aura"></div>
        <img class="tree-image" id="treeImage" alt="Vibe Bonsai" draggable="false" />
        <div class="weather-layer weather-front" id="weatherFront"></div>
        <div class="level-badge" id="petLevelBadge">Lv.1</div>
        <button class="pet-hitbox" id="petHitbox" type="button" aria-label="打开 Vibe Bonsai"></button>
      </section>
    </main>
  `;
} else {
  app.innerHTML = `
    <main class="manager-root" data-weather="clear" data-active="false">
      <aside class="pet-preview-panel">
        <header class="app-title">
          <p>Vibe Bonsai</p>
          <h1>Token 天气树</h1>
        </header>

        <section class="preview-stage" aria-label="桌面小树预览">
          <div class="weather-layer weather-back" id="previewWeatherBack"></div>
          <div class="pet-aura"></div>
          <img class="tree-image" id="previewTreeImage" alt="Vibe Bonsai preview" draggable="false" />
          <div class="weather-layer weather-front" id="previewWeatherFront"></div>
          <div class="level-badge preview-level" id="previewLevelBadge">Lv.1</div>
        </section>

        <div class="pet-controls">
          <button class="secondary-button" id="lockButton" type="button">锁定小树</button>
          <label class="scale-select">
            大小
            <select id="scaleSelect">
              <option value="0.5">0.5x</option>
              <option value="1">1x</option>
              <option value="1.5">1.5x</option>
              <option value="2">2x</option>
            </select>
          </label>
        </div>

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
      </aside>

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
          <div class="source-list">
            <article>
              <div>
                <span>Codex</span>
                <strong id="codexSourceStatus">检查中</strong>
              </div>
              <p id="codexSourceMeta">读取本机 session token_count</p>
            </article>
            <article>
              <div>
                <span>Claude Code</span>
                <strong id="claudeSourceStatus">检查中</strong>
              </div>
              <p id="claudeSourceMeta">读取本机 Claude session</p>
            </article>
            <article>
              <div>
                <span>OpenClaw</span>
                <strong id="openclawSourceStatus">检查中</strong>
              </div>
              <p id="openclawSourceMeta">读取本机 OpenClaw session</p>
            </article>
            <article>
              <div>
                <span>OpenCode</span>
                <strong id="opencodeSourceStatus">检查中</strong>
              </div>
              <p id="opencodeSourceMeta">读取本机 OpenCode message</p>
            </article>
          </div>
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
          <div class="source-breakdown" id="sourceBreakdown"></div>
        </section>

        <form class="token-form" id="tokenForm">
          <label>
            添加 XP
            <input id="tokensInput" inputmode="numeric" min="1" step="1" type="number" placeholder="10000" required />
          </label>
          <label>
            备注
            <input id="noteInput" type="text" placeholder="测试成长" />
          </label>
          <button class="primary-button" type="submit">喂养</button>
        </form>

        <section class="chart-card">
          <div class="section-header">
            <h3>最近 7 天</h3>
            <span id="peakText">5 分钟 +0 XP</span>
          </div>
        </section>
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
const tokenForm = document.querySelector<HTMLFormElement>("#tokenForm");
const tokensInput = document.querySelector<HTMLInputElement>("#tokensInput");
const noteInput = document.querySelector<HTMLInputElement>("#noteInput");
const lockButton = document.querySelector<HTMLButtonElement>("#lockButton");
const scaleSelect = document.querySelector<HTMLSelectElement>("#scaleSelect");
const launchOnStartupInput = document.querySelector<HTMLInputElement>("#launchOnStartupInput");
const silentStartupInput = document.querySelector<HTMLInputElement>("#silentStartupInput");
const codexSessionsDirInput = document.querySelector<HTMLInputElement>("#codexSessionsDirInput");
const claudeSessionsDirInput = document.querySelector<HTMLInputElement>("#claudeSessionsDirInput");
const openclawSessionsDirInput = document.querySelector<HTMLInputElement>("#openclawSessionsDirInput");
const opencodeSessionsDirInput = document.querySelector<HTMLInputElement>("#opencodeSessionsDirInput");

if (viewMode === "manager") {
  setupHistoryCard();
}

const historyBars = document.querySelector<HTMLElement>("#historyBars");
const historyTabs = document.querySelector<HTMLElement>("#historyTabs");

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

  window.bonsai.onLedger((nextLedger) => {
    ledger = nextLedger;
    render();
  });
  window.bonsai.onOpenAddToken(() => {
    tokensInput?.focus();
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
  }

  lockButton?.addEventListener("click", async () => {
    if (!ledger) return;
    ledger = await window.bonsai.updateSettings({ locked: !ledger.settings.locked });
    render();
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

  tokenForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const tokens = Number(tokensInput?.value);
    if (!Number.isFinite(tokens) || tokens <= 0) return;

    ledger = await window.bonsai.addEntry({
      tokens,
      note: noteInput?.value,
    });
    tokenForm.reset();
    render();
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

function render() {
  if (!ledger || !tree || !gameBalance) return;
  const stats = calculateStats(ledger.entries, tree, gameBalance);

  root.dataset.weather = stats.weather.id;
  root.dataset.locked = String(ledger.settings.locked);
  root.dataset.active = String(stats.recentXp > 0 || stats.weather.tokensPerMinute > 0);

  if (treeImage) {
    treeImage.src = assetUrl(stats.stage.image);
    treeImage.alt = `${tree.displayName} ${stats.stage.label}`;
  }
  if (previewTreeImage) {
    previewTreeImage.src = assetUrl(stats.stage.image);
    previewTreeImage.alt = `${tree.displayName} ${stats.stage.label}`;
  }

  text("#petLevelBadge", `Lv.${stats.level}`);
  text("#previewLevelBadge", `Lv.${stats.level}`);
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
  if (lockButton) lockButton.textContent = ledger.settings.locked ? "解锁小树" : "锁定小树";
  if (scaleSelect) scaleSelect.value = String(ledger.settings.scale);
  if (launchOnStartupInput) launchOnStartupInput.checked = ledger.settings.launchOnStartup;
  if (silentStartupInput) silentStartupInput.checked = ledger.settings.silentStartup;
  syncInputValue(codexSessionsDirInput, ledger.settings.codexSessionsDir ?? "");
  syncInputValue(claudeSessionsDirInput, ledger.settings.claudeSessionsDir ?? "");
  syncInputValue(openclawSessionsDirInput, ledger.settings.openclawSessionsDir ?? "");
  syncInputValue(opencodeSessionsDirInput, ledger.settings.opencodeSessionsDir ?? "");

  if (lastWeatherId !== stats.weather.id) {
    lastWeatherId = stats.weather.id;
    renderWeatherLayers(stats.weather.id);
  }
  renderUsageStatus();
  renderHistoryChart(getSevenDayRows(ledger.entries, historyFilter), historyFilter);
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
  const codexEntries = ledger?.entries.filter((entry) => entry.source === "codex-session").length ?? 0;
  const claudeEntries = ledger?.entries.filter((entry) => entry.source === "claude-session").length ?? 0;
  const openclawEntries = ledger?.entries.filter((entry) => entry.source === "openclaw-session").length ?? 0;
  const opencodeEntries = ledger?.entries.filter((entry) => entry.source === "opencode-session").length ?? 0;
  const activeSources = [codexEntries > 0, claudeEntries > 0, openclawEntries > 0, opencodeEntries > 0].filter(
    Boolean,
  ).length;
  text("#sourceSummary", activeSources ? `${activeSources} 个来源有记录` : "等待 token");

  const codex = usageStatus.codexSession;
  text("#codexSourceStatus", codex.exists && codex.running ? "监控中" : "未找到");
  text(
    "#codexSourceMeta",
    codex.lastEventAt
      ? `${codex.filesWatched} 个文件 · ${formatRelativeTime(codex.lastEventAt)}`
      : `${codex.filesWatched} 个文件 · 等待新 token`,
  );

  const claude = usageStatus.claudeSession;
  text("#claudeSourceStatus", claude.exists && claude.running ? "监控中" : "未找到");
  text(
    "#claudeSourceMeta",
    claude.lastEventAt
      ? `${claude.filesWatched} 个文件 · ${formatRelativeTime(claude.lastEventAt)}`
      : `${claude.filesWatched} 个文件 · 等待新 token`,
  );

  const openclaw = usageStatus.openclawSession;
  text("#openclawSourceStatus", openclaw.exists && openclaw.running ? "监控中" : "未找到");
  text(
    "#openclawSourceMeta",
    openclaw.lastEventAt
      ? `${openclaw.filesWatched} 个文件 · ${formatRelativeTime(openclaw.lastEventAt)}`
      : `${openclaw.filesWatched} 个文件 · 等待新 token`,
  );

  const opencode = usageStatus.opencodeSession;
  text("#opencodeSourceStatus", opencode.exists && opencode.running ? "监控中" : "未找到");
  text(
    "#opencodeSourceMeta",
    opencode.lastEventAt
      ? `${opencode.filesWatched} 个文件 · ${formatRelativeTime(opencode.lastEventAt)}`
      : `${opencode.filesWatched} 个文件 · 等待新 token`,
  );
}

function renderSourceBreakdown(rows: SourceBreakdown[]) {
  const element = document.querySelector<HTMLElement>("#sourceBreakdown");
  if (!element) return;
  const totalXp = rows.reduce((total, row) => total + row.xp, 0);
  const visibleRows = rows.filter((row) => row.xp > 0).slice(0, 4);
  if (!visibleRows.length) {
    element.innerHTML = `<p>还没有来源贡献</p>`;
    return;
  }
  element.innerHTML = visibleRows
    .map((row) => {
      const percent = totalXp > 0 ? Math.max(3, Math.round((row.xp / totalXp) * 100)) : 0;
      return `
        <article>
          <div>
            <strong>${escapeHtml(row.label)}</strong>
            <span>${formatCompact(row.xp)} XP</span>
          </div>
          <div class="source-meter"><span style="width:${percent}%"></span></div>
          <p>in ${formatCompact(row.inputTokens)} · out ${formatCompact(row.outputTokens)} · cache ${formatCompact(row.cacheReadTokens)}</p>
        </article>
      `;
    })
    .join("");
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
    displayName: "Vibe Bonsai",
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
    const tokens = entries
      .filter((entry) => sourceMatchesHistoryFilter(entry, filter) && dateKey(new Date(entry.createdAt)) === key)
      .reduce((total, entry) => total + xpForEntry(entry), 0);
    return {
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      tokens,
    };
  });
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

function renderHistoryChart(rows: Array<{ label: string; tokens: number }>, filter: HistoryFilter) {
  const labels: Record<HistoryFilter, string> = {
    all: "全部来源",
    codex: "Codex",
    openclaw: "OpenClaw",
    opencode: "OpenCode",
    claude: "Claude Code",
  };
  const total = rows.reduce((sum, row) => sum + row.tokens, 0);
  const max = Math.max(1, ...rows.map((row) => row.tokens));

  text("#historySummary", `${labels[filter]} · ${formatCompact(total)} XP`);

  historyTabs?.querySelectorAll<HTMLButtonElement>("[data-history-filter]").forEach((button) => {
    const active = button.dataset.historyFilter === filter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });

  if (!historyBars) return;
  historyBars.innerHTML = rows
    .map((row) => {
      const height = row.tokens > 0 ? Math.max(8, Math.round((row.tokens / max) * 100)) : 0;
      return `
        <article class="history-day">
          <div class="history-bar-shell">
            <span style="height:${height}%"></span>
          </div>
          <strong>${formatCompact(row.tokens)}</strong>
          <span>${row.label}</span>
        </article>
      `;
    })
    .join("");
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
