import { contextBridge, ipcRenderer } from "electron";
import type {
  AchievementState,
  AchievementUnlock,
  AchievementUnlockResult,
  CloudSyncStatus,
  LedgerFile,
  LeaderboardCollection,
  LeaderboardData,
  LeaderboardRange,
  LeaderboardStatus,
  Settings,
  ToastPlacement,
  TreeToastItem,
  UpdateStatus,
  UsageStatus,
  WindowBounds,
} from "../shared/types.js";

const api = {
  getLedger: () => ipcRenderer.invoke("ledger:get") as Promise<LedgerFile>,
  addEntry: (input: { tokens: number; note?: string }) =>
    ipcRenderer.invoke("ledger:add-entry", input) as Promise<LedgerFile>,
  updateSettings: (partial: Partial<Settings>) =>
    ipcRenderer.invoke("settings:update", partial) as Promise<LedgerFile>,
  setExpanded: (expanded: boolean) => ipcRenderer.invoke("window:set-expanded", expanded) as Promise<boolean>,
  getWindowBounds: () => ipcRenderer.invoke("window:get-bounds") as Promise<WindowBounds | null>,
  setWindowPosition: (position: { x: number; y: number }) =>
    ipcRenderer.invoke("window:set-position", position) as Promise<void>,
  persistWindowPosition: () => ipcRenderer.invoke("window:persist-position") as Promise<void>,
  getUsageStatus: () => ipcRenderer.invoke("usage:get-status") as Promise<UsageStatus>,
  getUpdateStatus: () => ipcRenderer.invoke("updates:get-status") as Promise<UpdateStatus>,
  checkForUpdates: () => ipcRenderer.invoke("updates:check") as Promise<UpdateStatus>,
  installUpdate: () => ipcRenderer.invoke("updates:install") as Promise<UpdateStatus>,
  openUpdatePage: (url?: string) => ipcRenderer.invoke("updates:open", url) as Promise<void>,
  getLeaderboardStatus: () => ipcRenderer.invoke("leaderboard:get-status") as Promise<LeaderboardStatus>,
  loginLeaderboard: () => ipcRenderer.invoke("leaderboard:login") as Promise<LeaderboardStatus>,
  logoutLeaderboard: () => ipcRenderer.invoke("leaderboard:logout") as Promise<LeaderboardStatus>,
  setLeaderboardEnabled: (enabled: boolean) =>
    ipcRenderer.invoke("leaderboard:set-enabled", enabled) as Promise<LeaderboardStatus>,
  syncLeaderboard: (options?: { force?: boolean }) =>
    ipcRenderer.invoke("leaderboard:sync", options) as Promise<LeaderboardStatus>,
  getLeaderboard: (range: LeaderboardRange) => ipcRenderer.invoke("leaderboard:get", range) as Promise<LeaderboardData>,
  getLeaderboards: () => ipcRenderer.invoke("leaderboard:get-all") as Promise<LeaderboardCollection>,
  getCloudSyncStatus: () => ipcRenderer.invoke("cloud-sync:get-status") as Promise<CloudSyncStatus>,
  startNewTree: () => ipcRenderer.invoke("cloud-sync:start-new") as Promise<CloudSyncStatus>,
  enableCloudSync: () => ipcRenderer.invoke("cloud-sync:enable") as Promise<CloudSyncStatus>,
  joinExistingTree: () => ipcRenderer.invoke("cloud-sync:join-existing") as Promise<CloudSyncStatus>,
  cancelCloudAuth: () => ipcRenderer.invoke("cloud-sync:cancel-auth") as Promise<CloudSyncStatus>,
  syncCloudTree: () => ipcRenderer.invoke("cloud-sync:sync") as Promise<CloudSyncStatus>,
  getAchievements: () => ipcRenderer.invoke("achievements:get") as Promise<AchievementState>,
  unlockAchievements: (items: Array<{ id: string; trigger?: Record<string, unknown> }>) =>
    ipcRenderer.invoke("achievements:unlock", items) as Promise<AchievementUnlockResult>,
  previewAchievementToast: (id: string) => ipcRenderer.invoke("achievements:preview-toast", id) as Promise<boolean>,
  updateAchievementStats: (stats: Record<string, unknown>) =>
    ipcRenderer.invoke("achievements:update-stats", stats) as Promise<AchievementState>,
  reconcileAchievements: (input: { version: number; unlockedIds: string[]; stats?: Record<string, unknown> }) =>
    ipcRenderer.invoke("achievements:reconcile", input) as Promise<AchievementState>,
  saveShareImage: (input: { filename: string; pngBase64: string }) =>
    ipcRenderer.invoke("share:save-image", input) as Promise<{ canceled: boolean; filePath?: string }>,
  showLevelToast: (input: { from: number; to: number }) => ipcRenderer.send("level:toast", input),
  notifyAchievementToastReady: () => ipcRenderer.send("achievements:toast-ready"),
  notifyAchievementToastDrained: () => ipcRenderer.send("achievements:toast-drained"),
  notifyManagerReady: () => ipcRenderer.send("manager:ready"),
  onLedger: (callback: (ledger: LedgerFile) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, ledger: LedgerFile) => callback(ledger);
    ipcRenderer.on("bonsai:ledger", listener);
    return () => ipcRenderer.removeListener("bonsai:ledger", listener);
  },
  onExpanded: (callback: (expanded: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, expanded: boolean) => callback(expanded);
    ipcRenderer.on("bonsai:expanded", listener);
    return () => ipcRenderer.removeListener("bonsai:expanded", listener);
  },
  onOpenAddToken: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("bonsai:open-add-token", listener);
    return () => ipcRenderer.removeListener("bonsai:open-add-token", listener);
  },
  onOpenSettings: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("bonsai:open-settings", listener);
    return () => ipcRenderer.removeListener("bonsai:open-settings", listener);
  },
  onUsageStatus: (callback: (status: UsageStatus) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: UsageStatus) => callback(status);
    ipcRenderer.on("bonsai:usage-status", listener);
    return () => ipcRenderer.removeListener("bonsai:usage-status", listener);
  },
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: UpdateStatus) => callback(status);
    ipcRenderer.on("bonsai:update-status", listener);
    return () => ipcRenderer.removeListener("bonsai:update-status", listener);
  },
  onLeaderboardStatus: (callback: (status: LeaderboardStatus) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: LeaderboardStatus) => callback(status);
    ipcRenderer.on("bonsai:leaderboard-status", listener);
    return () => ipcRenderer.removeListener("bonsai:leaderboard-status", listener);
  },
  onAchievements: (callback: (state: AchievementState, unlocked: AchievementUnlock[]) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      state: AchievementState,
      unlocked: AchievementUnlock[],
    ) => callback(state, unlocked);
    ipcRenderer.on("bonsai:achievements", listener);
    return () => ipcRenderer.removeListener("bonsai:achievements", listener);
  },
  onPreviewAchievementToast: (callback: (id: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, id: string) => callback(id);
    ipcRenderer.on("bonsai:preview-achievement-toast", listener);
    return () => ipcRenderer.removeListener("bonsai:preview-achievement-toast", listener);
  },
  onAchievementToast: (callback: (payload: { ids?: string[]; items?: TreeToastItem[]; placement: ToastPlacement }) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: { ids?: string[]; items?: TreeToastItem[]; placement: ToastPlacement },
    ) => callback(payload);
    ipcRenderer.on("bonsai:achievement-toast", listener);
    return () => ipcRenderer.removeListener("bonsai:achievement-toast", listener);
  },
  onAchievementToastPlacement: (callback: (placement: ToastPlacement) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, placement: ToastPlacement) => callback(placement);
    ipcRenderer.on("bonsai:achievement-toast-placement", listener);
    return () => ipcRenderer.removeListener("bonsai:achievement-toast-placement", listener);
  },
};

contextBridge.exposeInMainWorld("bonsai", api);

declare global {
  interface Window {
    bonsai: typeof api;
  }
}
