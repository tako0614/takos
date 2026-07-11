export type View =
  | "loading"
  | "login"
  | "home"
  | "profile"
  | "repos"
  | "repo"
  | "memory"
  | "deploy"
  | "apps"
  | "connections"
  | "store"
  | "chat"
  | "storage"
  | "legal"
  | "share"
  | "space-settings"
  | "settings";

export const DEPLOY_SECTIONS = ["workers", "resources"] as const;
export type DeploySection = (typeof DEPLOY_SECTIONS)[number];
export const DEPLOY_NAV_SECTIONS = [
  "workers",
  "resources",
] as const satisfies readonly DeploySection[];

const DEPLOY_SECTION_SET = new Set<string>(DEPLOY_SECTIONS);

export function isDeploySection(
  value: string | undefined,
): value is DeploySection {
  return typeof value === "string" && DEPLOY_SECTION_SET.has(value);
}

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
  ref?: string;
  workerId?: string;
  username?: string;
  repoId?: string;
  repoName?: string;
  deploySection?: DeploySection;
  storeTab?: "discover" | "installed";
  connectionServer?: string;
  storagePath?: string;
  legalPage?: LegalPageType;
}
