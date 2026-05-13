import { contextBridge, ipcRenderer } from "electron";
import type {
  AchievementState,
  AchievementUnlock,
  AchievementUnlockResult,
  LedgerFile,
  Settings,
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
  getAchievements: () => ipcRenderer.invoke("achievements:get") as Promise<AchievementState>,
  unlockAchievements: (items: Array<{ id: string; trigger?: Record<string, unknown> }>) =>
    ipcRenderer.invoke("achievements:unlock", items) as Promise<AchievementUnlockResult>,
  previewAchievementToast: (id: string) => ipcRenderer.invoke("achievements:preview-toast", id) as Promise<boolean>,
  updateAchievementStats: (stats: Record<string, unknown>) =>
    ipcRenderer.invoke("achievements:update-stats", stats) as Promise<AchievementState>,
  notifyAchievementToastReady: () => ipcRenderer.send("achievements:toast-ready"),
  notifyAchievementToastDrained: () => ipcRenderer.send("achievements:toast-drained"),
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
  onUsageStatus: (callback: (status: UsageStatus) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: UsageStatus) => callback(status);
    ipcRenderer.on("bonsai:usage-status", listener);
    return () => ipcRenderer.removeListener("bonsai:usage-status", listener);
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
  onAchievementToast: (callback: (payload: { ids: string[]; placement: "left" | "right" }) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: { ids: string[]; placement: "left" | "right" },
    ) => callback(payload);
    ipcRenderer.on("bonsai:achievement-toast", listener);
    return () => ipcRenderer.removeListener("bonsai:achievement-toast", listener);
  },
  onAchievementToastPlacement: (callback: (placement: "left" | "right") => void) => {
    const listener = (_event: Electron.IpcRendererEvent, placement: "left" | "right") => callback(placement);
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
