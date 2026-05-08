import type { LedgerFile, Settings, UsageStatus, WindowBounds } from "../shared/types";

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
      onLedger: (callback: (ledger: LedgerFile) => void) => () => void;
      onExpanded: (callback: (expanded: boolean) => void) => () => void;
      onOpenAddToken: (callback: () => void) => () => void;
      onUsageStatus: (callback: (status: UsageStatus) => void) => () => void;
    };
  }
}
