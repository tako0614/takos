export type View =
  | "loading"
  | "login"
  | "home"
  | "app"
  | "profile"
  | "repos"
  | "repo"
  | "memory"
  | "deploy"
  | "groups"
  | "apps"
  | "store"
  | "chat"
  | "storage"
  | "legal"
  | "share"
  | "space-settings"
  | "settings"
  | "oauth-authorize"
  | "oauth-device";

export const DEPLOY_SECTIONS = [
  "workers",
  "resources",
  "groups",
] as const;
export type DeploySection = (typeof DEPLOY_SECTIONS)[number];
export const DEPLOY_NAV_SECTIONS = [
  "workers",
  "resources",
  "groups",
] as const satisfies readonly DeploySection[];

const DEPLOY_SECTION_SET = new Set<string>(DEPLOY_SECTIONS);

export function isDeploySection(
  value: string | undefined,
): value is DeploySection {
  return typeof value === "string" && DEPLOY_SECTION_SET.has(value);
}

export type LegalPageType = "terms" | "privacy" | "tokushoho";

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
  appId?: string;
  workerId?: string;
  groupId?: string;
  username?: string;
  repoId?: string;
  repoName?: string;
  deploySection?: DeploySection;
  storeTab?: "discover" | "installed";
  storagePath?: string;
  legalPage?: LegalPageType;
  oauthQuery?: string;
}
