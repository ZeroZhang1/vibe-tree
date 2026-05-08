const { contextBridge, ipcRenderer } = require("electron");

const api = {
  getLedger: () => ipcRenderer.invoke("ledger:get"),
  addEntry: (input) => ipcRenderer.invoke("ledger:add-entry", input),
  updateSettings: (partial) => ipcRenderer.invoke("settings:update", partial),
  setExpanded: (expanded) => ipcRenderer.invoke("window:set-expanded", expanded),
  getWindowBounds: () => ipcRenderer.invoke("window:get-bounds"),
  setWindowPosition: (position) => ipcRenderer.invoke("window:set-position", position),
  persistWindowPosition: () => ipcRenderer.invoke("window:persist-position"),
  getUsageStatus: () => ipcRenderer.invoke("usage:get-status"),
  onLedger: (callback) => {
    const listener = (_event, ledger) => callback(ledger);
    ipcRenderer.on("bonsai:ledger", listener);
    return () => ipcRenderer.removeListener("bonsai:ledger", listener);
  },
  onExpanded: (callback) => {
    const listener = (_event, expanded) => callback(expanded);
    ipcRenderer.on("bonsai:expanded", listener);
    return () => ipcRenderer.removeListener("bonsai:expanded", listener);
  },
  onOpenAddToken: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("bonsai:open-add-token", listener);
    return () => ipcRenderer.removeListener("bonsai:open-add-token", listener);
  },
  onUsageStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("bonsai:usage-status", listener);
    return () => ipcRenderer.removeListener("bonsai:usage-status", listener);
  },
};

contextBridge.exposeInMainWorld("bonsai", api);
