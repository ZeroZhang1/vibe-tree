import { contextBridge, ipcRenderer } from "electron";
import type { LedgerFile, Settings, UsageStatus, WindowBounds } from "../shared/types.js";

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
};

contextBridge.exposeInMainWorld("bonsai", api);

declare global {
  interface Window {
    bonsai: typeof api;
  }
}
