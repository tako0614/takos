export type View =
  | "loading"
  | "login"
  | "home"
  | "profile"
  | "memory"
  | "apps"
  | "connections"
  | "store"
  | "chat"
  | "storage"
  | "legal"
  | "share"
  | "space-settings"
  | "settings";

export type LegalPageType = "terms" | "privacy" | "security" | "tokushoho";

export interface RouteState {
  view: View;
  spaceId?: string;
  workspaceSlug?: string;
  spaceSlug?: string;
  threadId?: string;
  runId?: string;
  messageId?: string;
  shareToken?: string;
  filePath?: string;
  fileLine?: number;
  workerId?: string;
  storeTab?: "discover" | "installed";
  connectionServer?: string;
  storagePath?: string;
  legalPage?: LegalPageType;
}
