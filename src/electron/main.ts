import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from "electron";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { LedgerEntry, LedgerFile, Settings, UsageEvent, UsageStatus, WindowBounds } from "../shared/types.js";
import { startClaudeSessionWatcher, startOpenClawSessionWatcher } from "./agentSessionWatchers.js";
import { startCodexSessionWatcher } from "./codexSessionWatcher.js";
import { startUsageGateway, type UsageGatewayStatus } from "./usageGateway.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PET_BASE = { width: 192, height: 208 };
const MANAGER_SIZE = { width: 980, height: 720 };
const MANAGER_MIN_SIZE = { width: 760, height: 560 };
const DEFAULT_SETTINGS: Settings = {
  locked: false,
  alwaysOnTop: true,
  scale: 2,
  windowPosition: undefined,
};

let petWindow: BrowserWindow | null = null;
let managerWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let ledger: LedgerFile = { entries: [], settings: DEFAULT_SETTINGS };
let usageGateway: ReturnType<typeof startUsageGateway> | null = null;
let codexSessionWatcher: ReturnType<typeof startCodexSessionWatcher> | null = null;
let claudeSessionWatcher: ReturnType<typeof startClaudeSessionWatcher> | null = null;
let openclawSessionWatcher: ReturnType<typeof startOpenClawSessionWatcher> | null = null;
let usageGatewayStatus: UsageGatewayStatus = {
  running: false,
  port: 18790,
  targetBaseUrl: "https://api.openai.com",
  hasUpstreamKey: false,
};
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

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const rendererFile = join(__dirname, "../renderer/index.html");
const preloadFile = join(__dirname, "preload.cjs");

function ledgerPath() {
  return join(app.getPath("userData"), "ledger.json");
}

function readLedger(): LedgerFile {
  try {
    const raw = readFileSync(ledgerPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<LedgerFile>;
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries.filter(isEntry) : [],
      settings: {
        ...DEFAULT_SETTINGS,
        ...(parsed.settings ?? {}),
      },
    };
  } catch {
    return { entries: [], settings: DEFAULT_SETTINGS };
  }
}

function writeLedger() {
  const path = ledgerPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(ledger, null, 2), "utf8");
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

function petSize(scale = ledger.settings.scale) {
  const safeScale = [1, 1.5, 2].includes(scale) ? scale : DEFAULT_SETTINGS.scale;
  return {
    width: Math.round(PET_BASE.width * safeScale),
    height: Math.round(PET_BASE.height * safeScale),
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
  return {
    x: Math.min(Math.max(position.x, display.x), display.x + display.width - size.width),
    y: Math.min(Math.max(position.y, display.y), display.y + display.height - size.height),
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
}

async function loadRenderer(window: BrowserWindow, view: "pet" | "manager") {
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
    title: "Vibe Bonsai Pet",
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
  void petWindow.webContents.setVisualZoomLevelLimits(1, 1);
  petWindow.on("moved", persistPetPosition);
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
    title: "Vibe Bonsai",
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
  void loadRenderer(managerWindow, "manager");
  return managerWindow;
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
  writeLedger();
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
  tray.setToolTip("Vibe Bonsai");
  tray.on("click", showManager);
  refreshTrayMenu();
}

function createTrayIcon() {
  const svg = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect width="32" height="32" fill="none"/>
      <rect x="13" y="13" width="6" height="10" fill="#7a4f2b"/>
      <rect x="8" y="9" width="16" height="8" fill="#5bbf7a"/>
      <rect x="11" y="5" width="10" height="8" fill="#82dc8f"/>
      <rect x="9" y="23" width="14" height="5" fill="#b76f3b"/>
      <rect x="7" y="21" width="18" height="3" fill="#f2a541"/>
    </svg>
  `);
  return nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${svg}`);
}

function refreshTrayMenu() {
  if (!tray) return;
  const gatewayLabel = usageGatewayStatus.running
    ? `Token 网关: 127.0.0.1:${usageGatewayStatus.port}`
    : `Token 网关: 未启动${usageGatewayStatus.error ? ` (${usageGatewayStatus.error})` : ""}`;

  const template = Menu.buildFromTemplate([
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
    {
      label: "添加 token",
      click: () => {
        showManager();
        managerWindow?.webContents.send("bonsai:open-add-token");
      },
    },
    { type: "separator" },
    {
      label: gatewayLabel,
      enabled: false,
    },
    {
      label: `Codex 登录用量: ${codexSessionStatus.running ? "监控中" : "检查中"}`,
      enabled: false,
    },
    {
      label: `Claude Code 用量: ${claudeSessionStatus.running ? "监控中" : "检查中"}`,
      enabled: false,
    },
    {
      label: `OpenClaw 用量: ${openclawSessionStatus.running ? "监控中" : "检查中"}`,
      enabled: false,
    },
    { type: "separator" },
    {
      label: "小树大小",
      submenu: [1, 1.5, 2].map((scale) => ({
        label: `${scale}x`,
        type: "radio",
        checked: ledger.settings.scale === scale,
        click: () => updateSettings({ scale }),
      })),
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
    { type: "separator" },
    {
      label: "退出",
      click: () => app.quit(),
    },
  ]);
  tray.setContextMenu(template);
}

function updateSettings(partial: Partial<Settings>) {
  ledger.settings = { ...ledger.settings, ...partial };
  petWindow?.setAlwaysOnTop(ledger.settings.alwaysOnTop, "floating");
  if (partial.scale) resizePetWindow();
  writeLedger();
  refreshTrayMenu();
  broadcast("bonsai:ledger", ledger);
}

function appendUsageEvent(event: UsageEvent) {
  if (ledger.entries.some((entry) => entry.id === event.id)) return;

  ledger.entries.unshift({
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
  });
  writeLedger();
  broadcast("bonsai:ledger", ledger);
}

function broadcast(channel: string, ...args: unknown[]) {
  for (const window of [petWindow, managerWindow]) {
    if (!window || window.isDestroyed()) continue;
    window.webContents.send(channel, ...args);
  }
}

function getUsageStatus(): UsageStatus {
  return {
    gateway: usageGatewayStatus,
    codexSession: codexSessionStatus,
    claudeSession: claudeSessionStatus,
    openclawSession: openclawSessionStatus,
  };
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  ledger = readLedger();
  usageGateway = startUsageGateway({
    userDataPath: app.getPath("userData"),
    onUsage: appendUsageEvent,
    onStatus: (status) => {
      usageGatewayStatus = status;
      refreshTrayMenu();
      broadcast("bonsai:usage-status", getUsageStatus());
    },
  });
  createPetWindow();
  createManagerWindow();
  createTray();
  setTimeout(() => {
    codexSessionWatcher = startCodexSessionWatcher({
      userDataPath: app.getPath("userData"),
      onUsage: appendUsageEvent,
      onStatus: (status) => {
        codexSessionStatus = status;
        refreshTrayMenu();
        broadcast("bonsai:usage-status", getUsageStatus());
      },
    });
    claudeSessionWatcher = startClaudeSessionWatcher({
      userDataPath: app.getPath("userData"),
      onUsage: appendUsageEvent,
      onStatus: (status) => {
        claudeSessionStatus = status;
        refreshTrayMenu();
        broadcast("bonsai:usage-status", getUsageStatus());
      },
    });
    openclawSessionWatcher = startOpenClawSessionWatcher({
      userDataPath: app.getPath("userData"),
      onUsage: appendUsageEvent,
      onStatus: (status) => {
        openclawSessionStatus = status;
        refreshTrayMenu();
        broadcast("bonsai:usage-status", getUsageStatus());
      },
    });
  }, 500);

  app.on("activate", () => {
    createPetWindow();
    showManager();
  });
});

app.on("window-all-closed", () => {
  // Keep the pet and tray process alive until the user exits from the tray menu.
});

app.on("before-quit", () => {
  codexSessionWatcher?.close();
  claudeSessionWatcher?.close();
  openclawSessionWatcher?.close();
  void usageGateway?.close();
});

ipcMain.handle("ledger:get", () => ledger);
ipcMain.handle("usage:get-status", getUsageStatus);

ipcMain.handle("ledger:add-entry", (_event, input: { tokens: number; note?: string }) => {
  const tokens = Math.max(0, Math.round(Number(input.tokens)));
  if (!tokens) return ledger;

  ledger.entries.unshift({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    source: "manual",
    tokens,
    note: input.note?.trim() || undefined,
  });
  writeLedger();
  broadcast("bonsai:ledger", ledger);
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
