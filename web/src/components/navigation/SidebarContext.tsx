import { createContext, useContext } from "solid-js";
import type { Space, Thread } from "../../types/index.ts";

export interface SidebarCallbacks {
  // Navigation
  onNewChat: () => void;
  onNavigateStorage: () => void;
  onNavigateDeploy: () => void;
  onNavigateGroups: () => void;
  onNavigateApps: () => void;
  onNavigateStore: () => void;
  onNavigateRepos: () => void;
  onOpenSearch: () => void;
  // Space navigation
  onCreateSpace: () => void;
  onEnterSpace: (ws: Space) => void;
  onExitSpace: () => void;
  onNavigateSpaceChat: () => void;
  onNavigateSpaceStorage: () => void;
  onNavigateSpaceDeploy: () => void;
  onNavigateSpaceGroups: () => void;
  onNavigateSpaceRepos: () => void;
  onNavigateSpaceApps: () => void;
  onNavigateSpaceSettings: () => void;
  onOpenSpaceSettings: (spaceId: string) => void;
  // Thread actions
  onSelectThread: (thread: Thread) => void;
  onDeleteThread: (threadId: string) => void;
  onToggleArchiveThread: (thread: Thread) => void;
  // Profile / settings
  onOpenAgentModal: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
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
