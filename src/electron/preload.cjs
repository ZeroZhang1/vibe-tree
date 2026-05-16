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
  getUpdateStatus: () => ipcRenderer.invoke("updates:get-status"),
  checkForUpdates: () => ipcRenderer.invoke("updates:check"),
  installUpdate: () => ipcRenderer.invoke("updates:install"),
  openUpdatePage: (url) => ipcRenderer.invoke("updates:open", url),
  getLeaderboardStatus: () => ipcRenderer.invoke("leaderboard:get-status"),
  loginLeaderboard: () => ipcRenderer.invoke("leaderboard:login"),
  logoutLeaderboard: () => ipcRenderer.invoke("leaderboard:logout"),
  setLeaderboardEnabled: (enabled) => ipcRenderer.invoke("leaderboard:set-enabled", enabled),
  syncLeaderboard: (options) => ipcRenderer.invoke("leaderboard:sync", options),
  getLeaderboard: (range) => ipcRenderer.invoke("leaderboard:get", range),
  getLeaderboards: () => ipcRenderer.invoke("leaderboard:get-all"),
  getAchievements: () => ipcRenderer.invoke("achievements:get"),
  unlockAchievements: (items) => ipcRenderer.invoke("achievements:unlock", items),
  previewAchievementToast: (id) => ipcRenderer.invoke("achievements:preview-toast", id),
  updateAchievementStats: (stats) => ipcRenderer.invoke("achievements:update-stats", stats),
  reconcileAchievements: (input) => ipcRenderer.invoke("achievements:reconcile", input),
  saveShareImage: (input) => ipcRenderer.invoke("share:save-image", input),
  notifyAchievementToastReady: () => ipcRenderer.send("achievements:toast-ready"),
  notifyAchievementToastDrained: () => ipcRenderer.send("achievements:toast-drained"),
  notifyManagerReady: () => ipcRenderer.send("manager:ready"),
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
  onOpenSettings: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("bonsai:open-settings", listener);
    return () => ipcRenderer.removeListener("bonsai:open-settings", listener);
  },
  onUsageStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("bonsai:usage-status", listener);
    return () => ipcRenderer.removeListener("bonsai:usage-status", listener);
  },
  onUpdateStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("bonsai:update-status", listener);
    return () => ipcRenderer.removeListener("bonsai:update-status", listener);
  },
  onLeaderboardStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("bonsai:leaderboard-status", listener);
    return () => ipcRenderer.removeListener("bonsai:leaderboard-status", listener);
  },
  onAchievements: (callback) => {
    const listener = (_event, state, unlocked) => callback(state, unlocked);
    ipcRenderer.on("bonsai:achievements", listener);
    return () => ipcRenderer.removeListener("bonsai:achievements", listener);
  },
  onPreviewAchievementToast: (callback) => {
    const listener = (_event, id) => callback(id);
    ipcRenderer.on("bonsai:preview-achievement-toast", listener);
    return () => ipcRenderer.removeListener("bonsai:preview-achievement-toast", listener);
  },
  onAchievementToast: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("bonsai:achievement-toast", listener);
    return () => ipcRenderer.removeListener("bonsai:achievement-toast", listener);
  },
  onAchievementToastPlacement: (callback) => {
    const listener = (_event, placement) => callback(placement);
    ipcRenderer.on("bonsai:achievement-toast-placement", listener);
    return () => ipcRenderer.removeListener("bonsai:achievement-toast-placement", listener);
  },
};

contextBridge.exposeInMainWorld("bonsai", api);
