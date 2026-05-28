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
} from "../shared/types";

declare global {
  interface Window {
    bonsai: {
      getLedger: () => Promise<LedgerFile>;
      addEntry: (input: { tokens: number; note?: string }) => Promise<LedgerFile>;
      updateSettings: (partial: Partial<Settings>) => Promise<LedgerFile>;
      setExpanded: (expanded: boolean) => Promise<boolean>;
      getWindowBounds: () => Promise<WindowBounds | null>;
      setWindowPosition: (position: { x: number; y: number }) => Promise<void>;
      persistWindowPosition: () => Promise<void>;
      getUsageStatus: () => Promise<UsageStatus>;
      getUpdateStatus: () => Promise<UpdateStatus>;
      checkForUpdates: () => Promise<UpdateStatus>;
      installUpdate: () => Promise<UpdateStatus>;
      openUpdatePage: (url?: string) => Promise<void>;
      getLeaderboardStatus: () => Promise<LeaderboardStatus>;
      loginLeaderboard: () => Promise<LeaderboardStatus>;
      logoutLeaderboard: () => Promise<LeaderboardStatus>;
      setLeaderboardEnabled: (enabled: boolean) => Promise<LeaderboardStatus>;
      syncLeaderboard: (options?: { force?: boolean }) => Promise<LeaderboardStatus>;
      getLeaderboard: (range: LeaderboardRange) => Promise<LeaderboardData>;
      getLeaderboards: () => Promise<LeaderboardCollection>;
      getCloudSyncStatus: () => Promise<CloudSyncStatus>;
      startNewTree: () => Promise<CloudSyncStatus>;
      enableCloudSync: () => Promise<CloudSyncStatus>;
      joinExistingTree: () => Promise<CloudSyncStatus>;
      cancelCloudAuth: () => Promise<CloudSyncStatus>;
      syncCloudTree: () => Promise<CloudSyncStatus>;
      getAchievements: () => Promise<AchievementState>;
      unlockAchievements: (items: Array<{ id: string; trigger?: Record<string, unknown> }>) => Promise<AchievementUnlockResult>;
      previewAchievementToast: (id: string) => Promise<boolean>;
      updateAchievementStats: (stats: Record<string, unknown>) => Promise<AchievementState>;
      reconcileAchievements: (input: { version: number; unlockedIds: string[]; stats?: Record<string, unknown> }) => Promise<AchievementState>;
      saveShareImage: (input: { filename: string; pngBase64: string }) => Promise<{ canceled: boolean; filePath?: string }>;
      showLevelToast: (input: { from: number; to: number }) => void;
      notifyAchievementToastReady: () => void;
      notifyAchievementToastDrained: () => void;
      notifyManagerReady: () => void;
      onLedger: (callback: (ledger: LedgerFile) => void) => () => void;
      onExpanded: (callback: (expanded: boolean) => void) => () => void;
      onOpenAddToken: (callback: () => void) => () => void;
      onOpenSettings: (callback: () => void) => () => void;
      onUsageStatus: (callback: (status: UsageStatus) => void) => () => void;
      onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void;
      onLeaderboardStatus: (callback: (status: LeaderboardStatus) => void) => () => void;
      onAchievements: (callback: (state: AchievementState, unlocked: AchievementUnlock[]) => void) => () => void;
      onPreviewAchievementToast: (callback: (id: string) => void) => () => void;
      onAchievementToast: (callback: (payload: { ids?: string[]; items?: TreeToastItem[]; placement: ToastPlacement }) => void) => () => void;
      onAchievementToastPlacement: (callback: (placement: ToastPlacement) => void) => () => void;
    };
  }
}
