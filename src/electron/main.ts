import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from "electron";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { MenuItemConstructorOptions } from "electron";
import type {
  AchievementState,
  AchievementUnlock,
  AchievementUnlockResult,
  LedgerEntry,
  LedgerFile,
  Settings,
  UsageEvent,
  UsageStatus,
  WindowBounds,
} from "../shared/types.js";
import { startClaudeSessionWatcher, startOpenClawSessionWatcher, startOpenCodeSessionWatcher } from "./agentSessionWatchers.js";
import { startCodexSessionWatcher } from "./codexSessionWatcher.js";

const PET_BASE = { width: 192, height: 208 };
const PET_STAGE_OFFSET = { x: 20, y: 0 };
const ACHIEVEMENT_TOAST_SIZE = { width: 236, height: 104 };
const ACHIEVEMENT_TOAST_OVERLAP_PER_SCALE = 48;
const ACHIEVEMENT_TOAST_DOWN_OFFSET_PER_SCALE = 18;
const ACHIEVEMENT_TOAST_DURATION_MS = 5_000;
const ACHIEVEMENT_TOAST_WINDOW_PADDING_MS = 600;
const MAC_TRAY_ICON_SIZE = 18;
const MANAGER_SIZE = { width: 1120, height: 760 };
const MANAGER_MIN_SIZE = { width: 860, height: 620 };
const APP_NAME = "Vibe Tree";
const APP_ID = "com.vibetree.app";
const APP_ICON_PATHS = [
  join(__dirname, "../renderer/assets/app-icon.png"),
  join(__dirname, "../renderer/assets/app-icon.ico"),
  join(__dirname, "../../public/assets/app-icon.png"),
  join(__dirname, "../../public/assets/app-icon.ico"),
];
const DEFAULT_SETTINGS: Settings = {
  locked: false,
  alwaysOnTop: true,
  scale: 0.5,
  badgeFrontMetric: "level",
  badgeBackMetric: "total",
  totalDisplayUnit: "m",
  launchOnStartup: false,
  silentStartup: false,
  windowPosition: undefined,
};

const WEATHER_THRESHOLDS = [
  { id: "clear", label: "晴朗", minXpPerMinute: 0 },
  { id: "breeze", label: "微风", minXpPerMinute: 10_000 },
  { id: "drizzle", label: "细雨", minXpPerMinute: 50_000 },
  { id: "rain", label: "大雨", minXpPerMinute: 150_000 },
  { id: "thunder", label: "雷雨", minXpPerMinute: 500_000 },
  { id: "storm", label: "风暴", minXpPerMinute: 1_000_000 },
] as const;
const LEVEL_BASE = 100_000;
const LEVEL_EXPONENT = 1.65;
const MAX_LEVEL = 120;

let petWindow: BrowserWindow | null = null;
let managerWindow: BrowserWindow | null = null;
let achievementToastWindow: BrowserWindow | null = null;
let achievementToastHideTimer: ReturnType<typeof setTimeout> | null = null;
let achievementToastFallbackHideAt = 0;
let achievementToastRendererReady = false;
let achievementToastPendingIds: string[] = [];
let tray: Tray | null = null;
let ledger: LedgerFile = { entries: [], settings: DEFAULT_SETTINGS, installedAt: startOfLocalDayIso(new Date()) };
let achievementState: AchievementState = { unlocked: [] };
let codexSessionWatcher: ReturnType<typeof startCodexSessionWatcher> | null = null;
let claudeSessionWatcher: ReturnType<typeof startClaudeSessionWatcher> | null = null;
let openclawSessionWatcher: ReturnType<typeof startOpenClawSessionWatcher> | null = null;
let opencodeSessionWatcher: ReturnType<typeof startOpenCodeSessionWatcher> | null = null;
let codexSessionStatus: UsageStatus["codexSession"] = {
  running: false,
  sessionsRoot: "",
  exists: false,
  filesWatched: 0,
  eventsImported: 0,
  importHistory: false,
};
let claudeSessionStatus: UsageStatus["claudeSession"] = {
  running: false,
  sessionsRoot: "",
  exists: false,
  filesWatched: 0,
  eventsImported: 0,
  importHistory: false,
};
let openclawSessionStatus: UsageStatus["openclawSession"] = {
  running: false,
  sessionsRoot: "",
  exists: false,
  filesWatched: 0,
  eventsImported: 0,
  importHistory: false,
};
let opencodeSessionStatus: UsageStatus["opencodeSession"] = {
  running: false,
  sessionsRoot: "",
  exists: false,
  filesWatched: 0,
  eventsImported: 0,
  importHistory: false,
};

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const rendererFile = join(__dirname, "../renderer/index.html");
const preloadFile = join(__dirname, "preload.cjs");

function ledgerPath() {
  return join(app.getPath("userData"), "ledger.json");
}

function usageEventsPath() {
  return join(app.getPath("userData"), "usage-events.jsonl");
}

function usageMetaPath() {
  return join(app.getPath("userData"), "usage-meta.json");
}

function deviceSettingsPath() {
  return join(app.getPath("userData"), "device-settings.json");
}

function achievementsPath() {
  return join(app.getPath("userData"), "achievements.json");
}

function readLedger(): LedgerFile {
  const legacy = readLegacyLedger();
  const installedAt = readInstalledAt(legacy);
  const settings = readDeviceSettings(legacy?.settings);
  let entries = readUsageEntries();

  if (!entries.length && legacy?.entries?.length) {
    entries = legacy.entries.filter(isEntry);
    for (const entry of entries.slice().reverse()) {
      appendUsageEntryToStore(entry);
    }
  }

  return {
    entries: entries.filter((entry) => entryTime(entry) >= Date.parse(installedAt)),
    settings,
    installedAt,
  };
}

function readLegacyLedger(): Partial<LedgerFile> | undefined {
  try {
    const raw = readFileSync(ledgerPath(), "utf8");
    return JSON.parse(raw) as Partial<LedgerFile>;
  } catch {
    return undefined;
  }
}

function readInstalledAt(legacy: Partial<LedgerFile> | undefined) {
  const existing = readJsonFile<{ installedAt?: string }>(usageMetaPath());
  if (typeof existing?.installedAt === "string" && Number.isFinite(Date.parse(existing.installedAt))) {
    return existing.installedAt;
  }

  const legacyInstalledAt =
    typeof legacy?.installedAt === "string" && Number.isFinite(Date.parse(legacy.installedAt))
      ? legacy.installedAt
      : legacyInstallDate();
  const installedAt = startOfLocalDayIso(new Date(legacyInstalledAt));
  writeJsonAtomic(usageMetaPath(), { version: 1, installedAt });
  return installedAt;
}

function legacyInstallDate() {
  try {
    if (existsSync(ledgerPath())) {
      const stats = statSync(ledgerPath());
      return new Date(stats.birthtimeMs || stats.mtimeMs).toISOString();
    }
  } catch {
    // Fall back to first run time below.
  }
  return new Date().toISOString();
}

function readDeviceSettings(legacySettings: Partial<Settings> | undefined): Settings {
  const stored = readJsonFile<Partial<Settings>>(deviceSettingsPath());
  const settings = normalizeSettings({
    ...DEFAULT_SETTINGS,
    ...(legacySettings ?? {}),
    ...(stored ?? {}),
  });
  if (!stored) {
    writeDeviceSettings(settings);
  }
  return settings;
}

function writeDeviceSettings(settings = ledger.settings) {
  writeJsonAtomic(deviceSettingsPath(), normalizeSettings(settings));
}

function readAchievementState(): AchievementState {
  return normalizeAchievementState(readJsonFile<AchievementState>(achievementsPath()));
}

function writeAchievementState(state = achievementState) {
  writeJsonAtomic(achievementsPath(), normalizeAchievementState(state));
}

function normalizeAchievementState(state: Partial<AchievementState> | undefined): AchievementState {
  const seen = new Set<string>();
  const unlocked = Array.isArray(state?.unlocked)
    ? state.unlocked.filter((item): item is AchievementUnlock => {
        if (typeof item?.id !== "string" || seen.has(item.id)) return false;
        if (typeof item.unlockedAt !== "string" || !Number.isFinite(Date.parse(item.unlockedAt))) return false;
        seen.add(item.id);
        return true;
      })
    : [];
  return {
    unlocked,
    stats: state?.stats && typeof state.stats === "object" ? state.stats : undefined,
  };
}

function unlockAchievements(items: Array<{ id: string; trigger?: Record<string, unknown> }>): AchievementUnlockResult {
  const existing = new Set(achievementState.unlocked.map((item) => item.id));
  const unlocked: AchievementUnlock[] = [];
  const now = new Date().toISOString();

  for (const item of items) {
    if (!item?.id || existing.has(item.id)) continue;
    existing.add(item.id);
    unlocked.push({
      id: item.id,
      unlockedAt: now,
      trigger: item.trigger,
    });
  }

  if (!unlocked.length) {
    return { state: achievementState, unlocked };
  }

  achievementState = normalizeAchievementState({
    ...achievementState,
    unlocked: [...achievementState.unlocked, ...unlocked],
  });
  writeAchievementState();
  broadcast("bonsai:achievements", achievementState, unlocked);
  showAchievementToastOverlay(unlocked.map((item) => item.id));
  return { state: achievementState, unlocked };
}

function normalizeSettings(settings: Partial<Settings>): Settings {
  const scale = typeof settings.scale === "number" && [0.5, 1, 1.5, 2].includes(settings.scale) ? settings.scale : 0.5;
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    locked: Boolean(settings.locked),
    alwaysOnTop: settings.alwaysOnTop !== false,
    launchOnStartup: Boolean(settings.launchOnStartup),
    silentStartup: Boolean(settings.silentStartup),
    scale,
    badgeFrontMetric: normalizeBadgeMetric(settings.badgeFrontMetric, "level"),
    badgeBackMetric: normalizeBadgeMetric(settings.badgeBackMetric, "total"),
    totalDisplayUnit: normalizeTotalDisplayUnit(settings.totalDisplayUnit),
    codexSessionsDir: cleanPath(settings.codexSessionsDir),
    claudeSessionsDir: cleanPath(settings.claudeSessionsDir),
    openclawSessionsDir: cleanPath(settings.openclawSessionsDir),
    opencodeSessionsDir: cleanPath(settings.opencodeSessionsDir),
  };
}

function normalizeBadgeMetric(value: unknown, fallback: Settings["badgeFrontMetric"]) {
  return value === "level" || value === "total" || value === "rate" ? value : fallback;
}

function normalizeTotalDisplayUnit(value: unknown): Settings["totalDisplayUnit"] {
  return value === "raw" || value === "k" || value === "m" || value === "wan" || value === "yi" ? value : "m";
}

function cleanPath(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readUsageEntries() {
  if (!existsSync(usageEventsPath())) return [];
  const byId = new Map<string, LedgerEntry>();
  const raw = readFileSync(usageEventsPath(), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parsed = parseJson(line);
    if (isEntry(parsed)) {
      byId.set(parsed.id, parsed);
    }
  }
  return [...byId.values()].sort((a, b) => entryTime(b) - entryTime(a));
}

function appendUsageEntryToStore(entry: LedgerEntry) {
  const path = usageEventsPath();
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
}

function writeJsonAtomic(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.tmp`;
  writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf8");
  renameSync(tempPath, path);
}

function readJsonFile<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function isEntry(value: unknown): value is LedgerEntry {
  const entry = value as LedgerEntry;
  return (
    typeof entry?.id === "string" &&
    typeof entry.createdAt === "string" &&
    typeof entry.source === "string" &&
    typeof entry.tokens === "number" &&
    Number.isFinite(entry.tokens)
  );
}

function parseJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function entryTime(entry: LedgerEntry) {
  const time = Date.parse(entry.createdAt);
  return Number.isFinite(time) ? time : 0;
}

function startOfLocalDayIso(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString();
}

function petSize(scale = ledger.settings.scale) {
  const safeScale = [0.5, 1, 1.5, 2].includes(scale) ? scale : DEFAULT_SETTINGS.scale;
  return {
    width: Math.round(PET_BASE.width * safeScale + PET_STAGE_OFFSET.x),
    height: Math.round(PET_BASE.height * safeScale + PET_STAGE_OFFSET.y),
  };
}

function defaultPetPosition(width: number, height: number) {
  const display = screen.getPrimaryDisplay().workArea;
  return {
    x: display.x + display.width - width - 40,
    y: display.y + display.height - height - 56,
  };
}

function clampPetPosition(position: { x: number; y: number }, size = petSize()) {
  const display = screen.getDisplayNearestPoint(position).workArea;
  const stageWidth = size.width - PET_STAGE_OFFSET.x;
  const stageHeight = size.height - PET_STAGE_OFFSET.y;
  return {
    x: Math.min(
      Math.max(position.x, display.x - PET_STAGE_OFFSET.x),
      display.x + display.width - PET_STAGE_OFFSET.x - stageWidth,
    ),
    y: Math.min(
      Math.max(position.y, display.y - PET_STAGE_OFFSET.y),
      display.y + display.height - PET_STAGE_OFFSET.y - stageHeight,
    ),
  };
}

function setPetBounds(position: { x: number; y: number }) {
  if (!petWindow) return;
  const size = petSize();
  const clamped = clampPetPosition(
    {
      x: Math.round(position.x),
      y: Math.round(position.y),
    },
    size,
  );
  petWindow.setBounds({ ...clamped, width: size.width, height: size.height }, false);
  syncAchievementToastPosition();
}

async function loadRenderer(window: BrowserWindow, view: "pet" | "manager" | "toast") {
  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    await window.loadURL(`${process.env.VITE_DEV_SERVER_URL}?view=${view}`);
    return;
  }
  await window.loadFile(rendererFile, { query: { view } });
}

function createPetWindow() {
  if (petWindow) return petWindow;

  const size = petSize();
  const position = clampPetPosition(ledger.settings.windowPosition ?? defaultPetPosition(size.width, size.height), size);
  petWindow = new BrowserWindow({
    width: size.width,
    height: size.height,
    x: position.x,
    y: position.y,
    title: `${APP_NAME} Pet`,
    icon: createAppIcon(),
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: ledger.settings.alwaysOnTop,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: preloadFile,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  petWindow.setAlwaysOnTop(ledger.settings.alwaysOnTop, "floating");
  petWindow.webContents.setZoomFactor(1);
  petWindow.webContents.on("zoom-changed", (event) => event.preventDefault());
  petWindow.webContents.on("context-menu", () => {
    showPetContextMenu();
  });
  void petWindow.webContents.setVisualZoomLevelLimits(1, 1);
  petWindow.on("moved", () => {
    syncAchievementToastPosition();
    persistPetPosition();
  });
  petWindow.on("resize", () => setPetBounds(petWindowPosition()));
  petWindow.on("closed", () => {
    petWindow = null;
  });
  void loadRenderer(petWindow, "pet");
  return petWindow;
}

function createManagerWindow() {
  if (managerWindow) return managerWindow;

  managerWindow = new BrowserWindow({
    width: MANAGER_SIZE.width,
    height: MANAGER_SIZE.height,
    minWidth: MANAGER_MIN_SIZE.width,
    minHeight: MANAGER_MIN_SIZE.height,
    title: APP_NAME,
    icon: createAppIcon(),
    frame: true,
    transparent: false,
    resizable: true,
    show: true,
    backgroundColor: "#f6f2e8",
    webPreferences: {
      preload: preloadFile,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  managerWindow.on("closed", () => {
    managerWindow = null;
    refreshTrayMenu();
  });
  managerWindow.webContents.setZoomFactor(1);
  managerWindow.webContents.on("zoom-changed", (event) => event.preventDefault());
  void managerWindow.webContents.setVisualZoomLevelLimits(1, 1);
  void loadRenderer(managerWindow, "manager");
  return managerWindow;
}

function createAchievementToastWindow() {
  if (achievementToastWindow && !achievementToastWindow.isDestroyed()) return achievementToastWindow;

  achievementToastRendererReady = false;
  achievementToastWindow = new BrowserWindow({
    width: ACHIEVEMENT_TOAST_SIZE.width,
    height: ACHIEVEMENT_TOAST_SIZE.height,
    title: `${APP_NAME} Achievement`,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: preloadFile,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  achievementToastWindow.setIgnoreMouseEvents(true);
  achievementToastWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  achievementToastWindow.setAlwaysOnTop(true, "floating");
  achievementToastWindow.webContents.setZoomFactor(1);
  achievementToastWindow.webContents.on("did-start-loading", () => {
    achievementToastRendererReady = false;
  });
  achievementToastWindow.webContents.on("zoom-changed", (event) => event.preventDefault());
  void achievementToastWindow.webContents.setVisualZoomLevelLimits(1, 1);
  achievementToastWindow.on("closed", () => {
    achievementToastWindow = null;
    achievementToastRendererReady = false;
    achievementToastFallbackHideAt = 0;
    if (achievementToastHideTimer) {
      clearTimeout(achievementToastHideTimer);
      achievementToastHideTimer = null;
    }
  });
  void loadRenderer(achievementToastWindow, "toast");
  return achievementToastWindow;
}

function achievementToastPlacement() {
  const size = ACHIEVEMENT_TOAST_SIZE;
  const fallbackPetSize = petSize();
  const fallbackPetPosition = defaultPetPosition(fallbackPetSize.width, fallbackPetSize.height);
  const petBounds = petWindow && !petWindow.isDestroyed() ? petWindow.getBounds() : {
    ...fallbackPetPosition,
    ...fallbackPetSize,
  };
  const display = screen.getDisplayMatching(petBounds).workArea;
  const minX = display.x + 8;
  const maxX = display.x + display.width - size.width - 8;
  const minY = display.y + 8;
  const maxY = display.y + display.height - size.height - 8;
  const overlap = Math.round(ACHIEVEMENT_TOAST_OVERLAP_PER_SCALE * ledger.settings.scale);
  const rightX = petBounds.x + petBounds.width - overlap;
  const leftX = petBounds.x - size.width + overlap;
  const canUseRight = rightX <= maxX;
  const canUseLeft = leftX >= minX;
  const placement = canUseRight || !canUseLeft ? "right" : "left";
  const rawX = placement === "right" ? rightX : leftX;
  const downOffset = Math.round(ACHIEVEMENT_TOAST_DOWN_OFFSET_PER_SCALE * ledger.settings.scale);
  const rawY = petBounds.y - size.height + overlap + downOffset;

  return {
    placement,
    bounds: {
      x: Math.min(Math.max(rawX, minX), maxX),
      y: Math.min(Math.max(rawY, minY), maxY),
      width: size.width,
      height: size.height,
    },
  };
}

function syncAchievementToastPosition() {
  if (!achievementToastWindow || achievementToastWindow.isDestroyed() || !achievementToastWindow.isVisible()) return;
  const { bounds, placement } = achievementToastPlacement();
  achievementToastWindow.setBounds(bounds, false);
  achievementToastWindow.webContents.send("bonsai:achievement-toast-placement", placement);
}

function clearAchievementToastHideTimer() {
  if (!achievementToastHideTimer) return;
  clearTimeout(achievementToastHideTimer);
  achievementToastHideTimer = null;
}

function scheduleAchievementToastFallbackHide(count: number) {
  const now = Date.now();
  achievementToastFallbackHideAt =
    Math.max(achievementToastFallbackHideAt, now) + count * (ACHIEVEMENT_TOAST_DURATION_MS + 200);
  clearAchievementToastHideTimer();
  achievementToastHideTimer = setTimeout(() => {
    if (achievementToastWindow && !achievementToastWindow.isDestroyed()) achievementToastWindow.hide();
    achievementToastHideTimer = null;
    achievementToastFallbackHideAt = 0;
  }, Math.max(0, achievementToastFallbackHideAt - now) + ACHIEVEMENT_TOAST_WINDOW_PADDING_MS);
}

function scheduleAchievementToastDrainedHide() {
  clearAchievementToastHideTimer();
  achievementToastHideTimer = setTimeout(() => {
    if (achievementToastWindow && !achievementToastWindow.isDestroyed()) achievementToastWindow.hide();
    achievementToastHideTimer = null;
    achievementToastFallbackHideAt = 0;
  }, ACHIEVEMENT_TOAST_WINDOW_PADDING_MS);
}

function flushAchievementToastOverlay() {
  if (
    !achievementToastWindow ||
    achievementToastWindow.isDestroyed() ||
    !achievementToastRendererReady ||
    !achievementToastPendingIds.length
  ) {
    return;
  }

  const ids = achievementToastPendingIds;
  achievementToastPendingIds = [];
  const { bounds, placement } = achievementToastPlacement();
  achievementToastWindow.setBounds(bounds, false);
  achievementToastWindow.setAlwaysOnTop(true, "floating");
  achievementToastWindow.webContents.send("bonsai:achievement-toast", { ids, placement });
  achievementToastWindow.showInactive();
  scheduleAchievementToastFallbackHide(ids.length);
}

function showAchievementToastOverlay(ids: string[]) {
  const cleanIds = ids.filter((id) => typeof id === "string" && id.length);
  if (!cleanIds.length) return;

  achievementToastPendingIds.push(...cleanIds);
  const window = createAchievementToastWindow();
  const { bounds, placement } = achievementToastPlacement();
  window.setBounds(bounds, false);
  window.setAlwaysOnTop(true, "floating");
  window.webContents.send("bonsai:achievement-toast-placement", placement);
  flushAchievementToastOverlay();
}

function showManager() {
  const window = createManagerWindow();
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  refreshTrayMenu();
}

function persistPetPosition() {
  if (!petWindow) return;
  const [x, y] = petWindow.getPosition();
  ledger.settings.windowPosition = clampPetPosition({ x, y });
  writeDeviceSettings();
}

function petWindowPosition() {
  if (!petWindow) {
    const size = petSize();
    return defaultPetPosition(size.width, size.height);
  }
  const [x, y] = petWindow.getPosition();
  return { x, y };
}

function resizePetWindow() {
  if (!petWindow) return;
  const [x, y] = petWindow.getPosition();
  setPetBounds({ x, y });
  persistPetPosition();
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip(APP_NAME);
  tray.on("click", showManager);
  refreshTrayMenu();
}

function createTrayIcon() {
  const icon = createAppIcon();
  if (process.platform !== "darwin") return icon;
  const resized = icon.resize({ width: MAC_TRAY_ICON_SIZE, height: MAC_TRAY_ICON_SIZE });
  return resized.isEmpty() ? icon : resized;
}

function createAppIcon() {
  for (const iconPath of APP_ICON_PATHS) {
    try {
      if (!existsSync(iconPath)) continue;
      const icon = nativeImage.createFromPath(iconPath);
      if (!icon.isEmpty()) return icon;
    } catch {
      // Fall back to the embedded icon below.
    }
  }

  const svg = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect width="32" height="32" fill="none"/>
      <rect x="10" y="25" width="13" height="3" fill="#0a0c09"/>
      <rect x="8" y="22" width="17" height="4" fill="#5a3824"/>
      <rect x="7" y="20" width="19" height="3" fill="#a7ea3e"/>
      <rect x="12" y="14" width="4" height="8" fill="#6f4425"/>
      <rect x="15" y="12" width="3" height="10" fill="#9a602f"/>
      <rect x="8" y="12" width="8" height="6" fill="#0a0c09"/>
      <rect x="10" y="10" width="8" height="6" fill="#a7ea3e"/>
      <rect x="12" y="9" width="5" height="3" fill="#d7ff57"/>
      <rect x="17" y="8" width="8" height="7" fill="#0a0c09"/>
      <rect x="16" y="6" width="8" height="7" fill="#a7ea3e"/>
      <rect x="18" y="5" width="5" height="3" fill="#d7ff57"/>
      <rect x="21" y="13" width="7" height="6" fill="#0a0c09"/>
      <rect x="20" y="11" width="7" height="6" fill="#94db3d"/>
      <rect x="22" y="10" width="4" height="2" fill="#d7ff57"/>
    </svg>
  `);
  return nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${svg}`);
}

function showPetContextMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: "打开管理窗口",
      click: showManager,
    },
    {
      label: ledger.settings.locked ? "解锁小树位置" : "锁定小树位置",
      type: "checkbox" as const,
      checked: ledger.settings.locked,
      click: () => updateSettings({ locked: !ledger.settings.locked }),
    },
    {
      label: "小树大小",
      submenu: scaleMenuItems(),
    },
    { type: "separator" as const },
    {
      label: "牌子正面",
      submenu: badgeMetricMenuItems("badgeFrontMetric"),
    },
    {
      label: "牌子背面",
      submenu: badgeMetricMenuItems("badgeBackMetric"),
    },
    {
      label: "总量单位",
      submenu: totalUnitMenuItems(),
    },
    { type: "separator" as const },
    {
      label: "隐藏小树",
      click: () => {
        petWindow?.hide();
        refreshTrayMenu();
      },
    },
  ]);
  menu.popup({ window: petWindow ?? undefined });
}

function scaleMenuItems(): MenuItemConstructorOptions[] {
  return [0.5, 1, 1.5, 2].map((scale) => ({
    label: `${scale}x`,
    type: "radio" as const,
    checked: ledger.settings.scale === scale,
    click: () => updateSettings({ scale }),
  }));
}

function badgeMetricMenuItems(key: "badgeFrontMetric" | "badgeBackMetric"): MenuItemConstructorOptions[] {
  const labels: Record<Settings["badgeFrontMetric"], string> = {
    level: "等级",
    total: "累计 token",
    rate: "token/s",
  };
  return (Object.keys(labels) as Settings["badgeFrontMetric"][]).map((metric) => ({
    label: labels[metric],
    type: "radio" as const,
    checked: ledger.settings[key] === metric,
    click: () => updateSettings({ [key]: metric } as Partial<Settings>),
  }));
}

function totalUnitMenuItems(): MenuItemConstructorOptions[] {
  return (["k", "m"] as const).map((unit) => ({
    label: unit,
    type: "radio" as const,
    checked: ledger.settings.totalDisplayUnit === unit,
    click: () => updateSettings({ totalDisplayUnit: unit }),
  }));
}

function refreshTrayMenu() {
  if (!tray) return;
  const trayStats = getTrayStats();
  const template = Menu.buildFromTemplate([
    {
      label: `${APP_NAME} · Lv.${trayStats.level} · ${trayStats.weatherLabel}`,
      enabled: false,
    },
    {
      label: `${formatCompact(trayStats.totalXp)} XP · 今日 +${formatCompact(trayStats.todayXp)} · ${formatCompact(
        trayStats.xpPerMinute,
      )} XP/min`,
      enabled: false,
    },
    { type: "separator" },
    {
      label: "打开管理窗口",
      click: showManager,
    },
    {
      label: petWindow?.isVisible() ? "隐藏小树" : "显示小树",
      click: () => {
        if (!petWindow) createPetWindow();
        petWindow?.isVisible() ? petWindow.hide() : petWindow?.show();
        refreshTrayMenu();
      },
    },
    { type: "separator" },
    {
      label: sourceStatusLabel("Codex", codexSessionStatus, "codex-session"),
      enabled: false,
    },
    {
      label: sourceStatusLabel("Claude Code", claudeSessionStatus, "claude-session"),
      enabled: false,
    },
    {
      label: sourceStatusLabel("OpenClaw", openclawSessionStatus, "openclaw-session"),
      enabled: false,
    },
    { type: "separator" },
    {
      label: "小树大小",
      submenu: scaleMenuItems(),
    },
    {
      label: "锁定小树位置",
      type: "checkbox",
      checked: ledger.settings.locked,
      click: () => updateSettings({ locked: !ledger.settings.locked }),
    },
    {
      label: "小树置顶",
      type: "checkbox",
      checked: ledger.settings.alwaysOnTop,
      click: () => updateSettings({ alwaysOnTop: !ledger.settings.alwaysOnTop }),
    },
    {
      label: "开机启动",
      type: "checkbox",
      checked: ledger.settings.launchOnStartup,
      click: () => updateSettings({ launchOnStartup: !ledger.settings.launchOnStartup }),
    },
    {
      label: "静默启动",
      type: "checkbox",
      checked: ledger.settings.silentStartup,
      click: () => updateSettings({ silentStartup: !ledger.settings.silentStartup }),
    },
    { type: "separator" },
    {
      label: "退出",
      click: () => app.quit(),
    },
  ]);
  tray.setContextMenu(template);
  tray.setToolTip(`${APP_NAME} · Lv.${trayStats.level} · ${trayStats.weatherLabel}`);
}

function getTrayStats() {
  const now = Date.now();
  const totalXp = ledger.entries.reduce((total, entry) => total + xpForEntry(entry), 0);
  const todayKey = dateKey(new Date());
  const todayXp = ledger.entries
    .filter((entry) => dateKey(new Date(entry.createdAt)) === todayKey)
    .reduce((total, entry) => total + xpForEntry(entry), 0);
  const recentXp = ledger.entries
    .filter((entry) => now - entryTime(entry) <= 60_000)
    .reduce((total, entry) => total + xpForEntry(entry), 0);
  const xpPerMinute = recentXp;
  const weather = WEATHER_THRESHOLDS.reduce((current, candidate) => {
    return xpPerMinute >= candidate.minXpPerMinute ? candidate : current;
  }, WEATHER_THRESHOLDS[0]);

  return {
    level: getLevel(totalXp),
    totalXp,
    todayXp,
    xpPerMinute,
    weatherLabel: weather.label,
  };
}

function sourceStatusLabel(label: string, status: UsageStatus["codexSession"], source: string) {
  const entries = ledger.entries.filter((entry) => entry.source === source);
  const state = status.exists && status.running ? "监控中" : status.running ? "未找到" : "已停止";
  const eventText = status.lastEventAt ? ` · ${formatRelativeTime(status.lastEventAt)}` : "";
  return `${label}: ${state} · ${status.filesWatched} 文件 · ${entries.length} 条${eventText}`;
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

function getLevel(totalXp: number) {
  let level = 1;
  let remaining = totalXp;
  let needed = xpForNextLevel(level);
  while (remaining >= needed && level < MAX_LEVEL) {
    remaining -= needed;
    level += 1;
    needed = xpForNextLevel(level);
  }
  return level;
}

function xpForNextLevel(level: number) {
  return Math.round(LEVEL_BASE * level ** LEVEL_EXPONENT);
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatCompact(value: number) {
  const absolute = Math.abs(value);
  if (absolute < 1_000) return `${Math.round(value)}`;
  if (absolute < 1_000_000) return `${trimNumber(absolute / 1_000)}k`;
  return `${trimNumber(absolute / 1_000_000)}m`;
}

function trimNumber(value: number) {
  return value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1).replace(/\.0$/, "") : value.toFixed(2).replace(/\.?0+$/, "");
}

function formatRelativeTime(isoTime: string) {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - Date.parse(isoTime)) / 1000));
  if (elapsedSeconds < 60) return "刚刚";
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes} 分钟前`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  return `${elapsedHours} 小时前`;
}

function updateSettings(partial: Partial<Settings>) {
  const previous = ledger.settings;
  ledger.settings = normalizeSettings({ ...ledger.settings, ...partial });
  petWindow?.setAlwaysOnTop(ledger.settings.alwaysOnTop, "floating");
  if (partial.scale !== undefined) resizePetWindow();
  writeDeviceSettings();
  if (partial.launchOnStartup !== undefined || partial.silentStartup !== undefined) {
    applyLoginItemSettings();
  }
  if (
    previous.codexSessionsDir !== ledger.settings.codexSessionsDir ||
    previous.claudeSessionsDir !== ledger.settings.claudeSessionsDir ||
    previous.openclawSessionsDir !== ledger.settings.openclawSessionsDir ||
    previous.opencodeSessionsDir !== ledger.settings.opencodeSessionsDir
  ) {
    restartUsageWatchers();
  }
  refreshTrayMenu();
  broadcast("bonsai:ledger", ledger);
}

function appendUsageEvent(event: UsageEvent) {
  if (ledger.entries.some((entry) => entry.id === event.id)) return;

  const entry: LedgerEntry = {
    id: event.id,
    createdAt: event.createdAt,
    source: event.source,
    tokens: event.totalTokens,
    note: `${event.agent}${event.model ? ` · ${event.model}` : ""}`,
    agent: event.agent,
    provider: event.provider,
    model: event.model,
    inputTokens: event.inputTokens,
    outputTokens: event.outputTokens,
    cacheReadTokens: event.cacheReadTokens,
    cacheWriteTokens: event.cacheWriteTokens,
  };
  ledger.entries.unshift(entry);
  appendUsageEntryToStore(entry);
  broadcast("bonsai:ledger", ledger);
  refreshTrayMenu();
}

function broadcast(channel: string, ...args: unknown[]) {
  for (const window of [petWindow, managerWindow]) {
    if (!window || window.isDestroyed()) continue;
    window.webContents.send(channel, ...args);
  }
}

function getUsageStatus(): UsageStatus {
  return {
    codexSession: codexSessionStatus,
    claudeSession: claudeSessionStatus,
    openclawSession: openclawSessionStatus,
    opencodeSession: opencodeSessionStatus,
  };
}

function startUsageWatchers() {
  stopUsageWatchers();
  const common = {
    userDataPath: app.getPath("userData"),
    historyStartAt: ledger.installedAt,
  };

  codexSessionWatcher = startCodexSessionWatcher({
    ...common,
    sessionsRoot: ledger.settings.codexSessionsDir,
    onUsage: appendUsageEvent,
    onStatus: (status) => {
      codexSessionStatus = status;
      refreshTrayMenu();
      broadcast("bonsai:usage-status", getUsageStatus());
    },
  });
  claudeSessionWatcher = startClaudeSessionWatcher({
    ...common,
    sessionsRoot: ledger.settings.claudeSessionsDir,
    onUsage: appendUsageEvent,
    onStatus: (status) => {
      claudeSessionStatus = status;
      refreshTrayMenu();
      broadcast("bonsai:usage-status", getUsageStatus());
    },
  });
  openclawSessionWatcher = startOpenClawSessionWatcher({
    ...common,
    sessionsRoot: ledger.settings.openclawSessionsDir,
    onUsage: appendUsageEvent,
    onStatus: (status) => {
      openclawSessionStatus = status;
      refreshTrayMenu();
      broadcast("bonsai:usage-status", getUsageStatus());
    },
  });
  opencodeSessionWatcher = startOpenCodeSessionWatcher({
    ...common,
    sessionsRoot: ledger.settings.opencodeSessionsDir,
    onUsage: appendUsageEvent,
    onStatus: (status) => {
      opencodeSessionStatus = status;
      refreshTrayMenu();
      broadcast("bonsai:usage-status", getUsageStatus());
    },
  });
}

function stopUsageWatchers() {
  codexSessionWatcher?.close();
  claudeSessionWatcher?.close();
  openclawSessionWatcher?.close();
  opencodeSessionWatcher?.close();
  codexSessionWatcher = null;
  claudeSessionWatcher = null;
  openclawSessionWatcher = null;
  opencodeSessionWatcher = null;
}

function restartUsageWatchers() {
  if (!app.isReady()) return;
  startUsageWatchers();
}

function applyLoginItemSettings() {
  if (!app.isReady()) return;
  if (!ledger.settings.launchOnStartup) {
    app.setLoginItemSettings({ openAtLogin: false });
    return;
  }
  app.setLoginItemSettings({
    openAtLogin: true,
    openAsHidden: ledger.settings.silentStartup,
    path: process.execPath,
    args: loginItemArgs(),
  });
}

function loginItemArgs() {
  if (app.isPackaged) return [];
  const entry = process.argv.find((arg, index) => index > 0 && /dist[\\/]electron[\\/]main\.js$/.test(arg));
  return entry ? [entry] : [];
}

app.whenReady().then(() => {
  app.setName(APP_NAME);
  app.setAppUserModelId(APP_ID);
  Menu.setApplicationMenu(null);
  ledger = readLedger();
  achievementState = readAchievementState();
  applyLoginItemSettings();
  createPetWindow();
  if (!ledger.settings.silentStartup) {
    createManagerWindow();
  }
  createTray();
  setTimeout(startUsageWatchers, 500);

  app.on("activate", () => {
    createPetWindow();
    showManager();
  });
});

app.on("window-all-closed", () => {
  // Keep the pet and tray process alive until the user exits from the tray menu.
});

app.on("before-quit", () => {
  stopUsageWatchers();
});

ipcMain.handle("ledger:get", () => ledger);
ipcMain.handle("usage:get-status", getUsageStatus);
ipcMain.handle("achievements:get", () => achievementState);
ipcMain.handle("achievements:unlock", (_event, items: Array<{ id: string; trigger?: Record<string, unknown> }>) =>
  unlockAchievements(Array.isArray(items) ? items : []),
);
ipcMain.handle("achievements:preview-toast", (_event, id: string) => {
  if (typeof id !== "string") return false;
  showAchievementToastOverlay([id]);
  return true;
});
ipcMain.handle("achievements:update-stats", (_event, stats: Record<string, unknown>) => {
  if (!stats || typeof stats !== "object") return achievementState;
  achievementState = normalizeAchievementState({
    ...achievementState,
    stats: { ...(achievementState.stats ?? {}), ...stats },
  });
  writeAchievementState();
  return achievementState;
});

ipcMain.on("achievements:toast-ready", (event) => {
  if (!achievementToastWindow || achievementToastWindow.isDestroyed()) return;
  if (event.sender !== achievementToastWindow.webContents) return;
  achievementToastRendererReady = true;
  flushAchievementToastOverlay();
});

ipcMain.on("achievements:toast-drained", (event) => {
  if (!achievementToastWindow || achievementToastWindow.isDestroyed()) return;
  if (event.sender !== achievementToastWindow.webContents) return;
  if (achievementToastPendingIds.length) {
    flushAchievementToastOverlay();
    return;
  }
  scheduleAchievementToastDrainedHide();
});

ipcMain.handle("ledger:add-entry", (_event, input: { tokens: number; note?: string }) => {
  const tokens = Math.max(0, Math.round(Number(input.tokens)));
  if (!tokens) return ledger;

  const entry: LedgerEntry = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    source: "manual",
    tokens,
    note: input.note?.trim() || undefined,
  };
  ledger.entries.unshift(entry);
  appendUsageEntryToStore(entry);
  broadcast("bonsai:ledger", ledger);
  refreshTrayMenu();
  return ledger;
});

ipcMain.handle("settings:update", (_event, partial: Partial<Settings>) => {
  updateSettings(partial);
  return ledger;
});

ipcMain.handle("window:set-expanded", (_event, expanded: boolean) => {
  if (expanded) showManager();
  return expanded;
});

ipcMain.handle("window:get-bounds", (): WindowBounds | null => {
  if (!petWindow) return null;
  return petWindow.getBounds();
});

ipcMain.handle("window:set-position", (_event, position: { x: number; y: number }) => {
  if (!petWindow || ledger.settings.locked) return;
  setPetBounds(position);
});

ipcMain.handle("window:persist-position", () => {
  persistPetPosition();
});
