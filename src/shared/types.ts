export interface LedgerEntry {
  id: string;
  createdAt: string;
  source: "manual" | string;
  tokens: number;
  note?: string;
  agent?: string;
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface Settings {
  locked: boolean;
  alwaysOnTop: boolean;
  scale: 0.5 | 1 | 1.5 | 2 | number;
  launchOnStartup: boolean;
  silentStartup: boolean;
  windowPosition?: {
    x: number;
    y: number;
  };
  codexSessionsDir?: string;
  claudeSessionsDir?: string;
  openclawSessionsDir?: string;
  opencodeSessionsDir?: string;
}

export interface LedgerFile {
  entries: LedgerEntry[];
  settings: Settings;
  installedAt: string;
}

export interface UsageEvent {
  id: string;
  createdAt: string;
  source: string;
  agent: string;
  provider: string;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  status?: number;
  durationMs?: number;
  streaming?: boolean;
}

export interface UsageStatus {
  codexSession: SessionMonitorStatus;
  claudeSession: SessionMonitorStatus;
  openclawSession: SessionMonitorStatus;
  opencodeSession: SessionMonitorStatus;
}

export interface SessionMonitorStatus {
  running: boolean;
  sessionsRoot: string;
  exists: boolean;
  filesWatched: number;
  eventsImported: number;
  importHistory: boolean;
  historyStartAt?: string;
  lastScanAt?: string;
  lastEventAt?: string;
}

export interface TreeStage {
  id: string;
  label: string;
  image: string;
}

export interface TreeAsset {
  id: string;
  displayName: string;
  baseSize: {
    width: number;
    height: number;
  };
  defaultScale: number;
  palette: {
    leaf: string;
    rain: string;
    storm: string;
    soilGlow: string;
    wind: string;
  };
  stages: TreeStage[];
}

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
