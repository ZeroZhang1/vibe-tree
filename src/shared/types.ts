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
  scale: 1 | 1.5 | 2 | number;
  windowPosition?: {
    x: number;
    y: number;
  };
}

export interface LedgerFile {
  entries: LedgerEntry[];
  settings: Settings;
}

export interface UsageEvent {
  id: string;
  createdAt: string;
  source: "gateway:codex" | string;
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
  gateway: {
    running: boolean;
    port: number;
    targetBaseUrl: string;
    hasUpstreamKey: boolean;
    error?: string;
  };
  codexSession: SessionMonitorStatus;
  claudeSession: SessionMonitorStatus;
  openclawSession: SessionMonitorStatus;
}

export interface SessionMonitorStatus {
  running: boolean;
  sessionsRoot: string;
  exists: boolean;
  filesWatched: number;
  eventsImported: number;
  importHistory: boolean;
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
