import { createContext, useContext } from "solid-js";
import type { Space, Thread } from "../../types/index.ts";

export interface SidebarCallbacks {
  // Navigation
  onNewChat: () => void;
  onNavigateStorage: () => void;
  onNavigateApps: () => void;
  onNavigateConnections: () => void;
  onNavigateMemory: () => void;
  onNavigateNotifications: () => void;
  onNavigateStore: () => void;
  onOpenSearch: () => void;
  // Space navigation
  onCreateSpace: () => void;
  onEnterSpace: (ws: Space) => void;
  onExitSpace: () => void;
  onNavigateSpaceChat: () => void;
  onNavigateSpaceStorage: () => void;
  onNavigateSpaceApps: () => void;
  onNavigateSpaceConnections: () => void;
  onNavigateSpaceSettings: () => void;
  onOpenSpaceSettings: (spaceId: string) => void;
  // Thread actions
  onSelectThread: (thread: Thread) => void;
  onDeleteThread: (threadId: string) => Promise<void>;
  onToggleArchiveThread: (thread: Thread) => Promise<boolean>;
  isThreadActionPending: (threadId: string) => boolean;
  onRetryThreads: () => void;
  // Profile / settings
  onOpenAgentModal: () => void;
  onOpenSettings: () => void;
  onLogout: () => Promise<void>;
}

export const SidebarContext = createContext<SidebarCallbacks>();

export function useSidebarCallbacks(): SidebarCallbacks {
  const ctx = useContext(SidebarContext);
  if (!ctx) {
    throw new Error(
      "useSidebarCallbacks must be used within a SidebarProvider",
    );
  }
  return ctx;
}
