import type {
  AchievementState,
  AchievementUnlock,
  AchievementUnlockResult,
  LedgerFile,
  Settings,
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
      getAchievements: () => Promise<AchievementState>;
      unlockAchievements: (items: Array<{ id: string; trigger?: Record<string, unknown> }>) => Promise<AchievementUnlockResult>;
      previewAchievementToast: (id: string) => Promise<boolean>;
      updateAchievementStats: (stats: Record<string, unknown>) => Promise<AchievementState>;
      onLedger: (callback: (ledger: LedgerFile) => void) => () => void;
      onExpanded: (callback: (expanded: boolean) => void) => () => void;
      onOpenAddToken: (callback: () => void) => () => void;
      onUsageStatus: (callback: (status: UsageStatus) => void) => () => void;
      onAchievements: (callback: (state: AchievementState, unlocked: AchievementUnlock[]) => void) => () => void;
      onPreviewAchievementToast: (callback: (id: string) => void) => () => void;
      onAchievementToast: (callback: (payload: { ids: string[]; placement: "left" | "right" }) => void) => () => void;
      onAchievementToastPlacement: (callback: (placement: "left" | "right") => void) => () => void;
    };
  }
}
