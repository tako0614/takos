import { isDeploySection } from "./types/index.ts";
import type { DeploySection, RouteState, View } from "./types/index.ts";

type RouteParts = string[];
type RouteMatch = (parts: RouteParts, search: string) => RouteState | undefined;
type RouteBuild = (state: RouteState) => string | undefined;

export type AppRouteComponentKey =
  | "oauth-authorize"
  | "oauth-device"
  | "terms"
  | "privacy"
  | "tokushoho"
  | "share"
  | "store"
  | "space-repo"
  | "repo"
  | "chat"
  | "repos"
  | "groups"
  | "storage"
  | "apps"
  | "deploy"
  | "memory"
  | "settings"
  | "space-settings"
  | "profile"
  | "legacy-app-store"
  | "legacy-app-repos"
  | "legacy-app-workers"
  | "legacy-app-resources"
  | "legacy-app"
  | "home";

export type AppRoutePlacement = "public" | "protected" | "fallback";

export interface AppRouteSchema {
  key: string;
  componentKey?: AppRouteComponentKey;
  componentPatterns?: readonly string[];
  placement?: AppRoutePlacement;
  match: RouteMatch;
  build?: RouteBuild;
}

const SIMPLE_TOP_LEVEL_VIEWS = {
  memory: "memory",
} as const satisfies Partial<Record<string, View>>;

const LEGAL_PAGE_TO_PATH = new Map<string, string>([
  ["privacy", "/privacy"],
  ["tokushoho", "/legal/tokushoho"],
]);

const DEPLOY_ALIAS_SECTIONS = {
  resources: "resources",
  workers: "workers",
  deployments: "workers",
  services: "workers",
} as const satisfies Partial<Record<string, DeploySection>>;

export function normalizeStoreTab(
  value?: string,
): "discover" | "installed" {
  return value === "installed" ? "installed" : "discover";
}

export function parsePositiveRouteInt(
  value: string | null | undefined,
): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function getRouteParentPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 1) return "/";
  return `/${parts.slice(0, -1).join("/")}`;
}

function parseDeploySection(
  value: string | undefined,
): DeploySection | undefined {
  return isDeploySection(value) ? value : undefined;
}

function appendSearchParams(
  pathname: string,
  params: URLSearchParams,
): string {
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function applyRouteSearchParams(route: RouteState, search: string): RouteState {
  if (!search) {
    return route;
  }

  const params = new URLSearchParams(search);

  if (route.view === "chat") {
    const runId = params.get("run") || undefined;
    const messageId = params.get("message") || undefined;

    if (!runId && !messageId) {
      return route;
    }

    return {
      ...route,
      runId,
      messageId,
    };
  }

  if (route.view === "repo") {
    const filePath = params.get("path") || undefined;
    const fileLine = parsePositiveRouteInt(params.get("line"));
    const ref = params.get("ref") || undefined;

    if (!filePath && !fileLine && !ref) {
      return route;
    }

    return {
      ...route,
      filePath,
      fileLine,
      ref,
    };
  }

  if (route.view === "storage") {
    const explicitFilePath = params.get("file") || undefined;
    const shouldOpenCurrentPath = params.get("open") === "1";
    const filePath = explicitFilePath ||
      (shouldOpenCurrentPath && route.storagePath && route.storagePath !== "/"
        ? route.storagePath
        : undefined);

    if (!filePath) {
      return route;
    }

    return {
      ...route,
      storagePath: getRouteParentPath(filePath),
      filePath,
    };
  }

  return route;
}

function buildOAuthAuthorizePath(state: RouteState): string {
  return state.oauthQuery
    ? `/oauth/authorize${state.oauthQuery}`
    : "/oauth/authorize";
}

function buildOAuthDevicePath(state: RouteState): string {
  return state.oauthQuery
    ? `/oauth/device${state.oauthQuery}`
    : "/oauth/device";
}

function buildLegalPath(state: RouteState): string {
  return LEGAL_PAGE_TO_PATH.get(state.legalPage ?? "") ?? "/terms";
}

function buildSharePath(state: RouteState): string {
  return state.shareToken ? `/share/${state.shareToken}` : "/";
}

function buildStorePath(state: RouteState): string {
  if (state.storeTab && state.storeTab !== "discover") {
    return `/store/${state.storeTab}`;
  }
  return "/store";
}

function buildChatPath(state: RouteState): string {
  const params = new URLSearchParams();
  if (state.runId) {
    params.set("run", state.runId);
  }
  if (state.messageId) {
    params.set("message", state.messageId);
  }

  if (state.spaceId && state.threadId) {
    return appendSearchParams(
      `/chat/${state.spaceId}/${state.threadId}`,
      params,
    );
  }
  if (state.spaceId) {
    return appendSearchParams(`/chat/${state.spaceId}`, params);
  }
  return appendSearchParams("/chat", params);
}

function buildDeployPath(state: RouteState): string {
  if (state.spaceId) {
    if (state.deploySection === "groups" && state.groupId) {
      return `/deploy/w/${state.spaceId}/groups/${state.groupId}`;
    }
    if (state.deploySection && state.deploySection !== "workers") {
      return `/deploy/w/${state.spaceId}/${state.deploySection}`;
    }
    return `/deploy/w/${state.spaceId}`;
  }
  if (state.deploySection && state.deploySection !== "workers") {
    if (state.deploySection === "groups" && state.groupId) {
      return `/deploy/groups/${state.groupId}`;
    }
    return `/deploy/${state.deploySection}`;
  }
  return "/deploy";
}

function buildReposPath(state: RouteState): string {
  if (state.spaceId) {
    return `/repos/${state.spaceId}`;
  }
  return "/repos";
}

function buildGroupsPath(state: RouteState): string {
  if (state.spaceId) {
    return state.groupId
      ? `/groups/${state.spaceId}/${state.groupId}`
      : `/groups/${state.spaceId}`;
  }
  return "/groups";
}

function buildAppsPath(state: RouteState): string {
  if (state.spaceId) {
    return `/apps/${state.spaceId}`;
  }
  return "/apps";
}

function buildStoragePath(state: RouteState): string {
  const params = new URLSearchParams();
  const effectivePath = state.filePath || state.storagePath;
  if (state.filePath) {
    params.set("open", "1");
  }

  if (state.spaceId) {
    const basePath = effectivePath && effectivePath !== "/"
      ? `/storage/${state.spaceId}${effectivePath}`
      : `/storage/${state.spaceId}`;
    return appendSearchParams(basePath, params);
  }

  return "/storage";
}

function buildRepoPath(state: RouteState): string | undefined {
  let basePath: string | undefined;
  if (state.username && state.repoName) {
    basePath = `/${state.username}/${state.repoName}`;
  } else if (state.spaceId && state.repoId) {
    basePath = `/w/${state.spaceId}/repos/${state.repoId}`;
  }

  if (!basePath) {
    return undefined;
  }

  const params = new URLSearchParams();
  if (state.ref) {
    params.set("ref", state.ref);
  }
  if (state.filePath) {
    params.set("path", state.filePath);
  }
  if (
    typeof state.fileLine === "number" && Number.isFinite(state.fileLine) &&
    state.fileLine > 0
  ) {
    params.set("line", String(state.fileLine));
  }

  return appendSearchParams(basePath, params);
}

function buildAppPath(state: RouteState): string | undefined {
  return state.appId ? `/app/${state.appId}` : undefined;
}

function buildProfilePath(state: RouteState): string | undefined {
  return state.username ? `/@${state.username}` : undefined;
}

export const APP_ROUTE_SCHEMAS: readonly AppRouteSchema[] = [
  {
    key: "oauth-authorize",
    componentKey: "oauth-authorize",
    componentPatterns: ["/oauth/authorize"],
    placement: "public",
    match: (parts, search) =>
      parts[0] === "oauth" && parts[1] === "authorize"
        ? { view: "oauth-authorize", oauthQuery: search }
        : undefined,
    build: (state) =>
      state.view === "oauth-authorize"
        ? buildOAuthAuthorizePath(state)
        : undefined,
  },
  {
    key: "oauth-device",
    componentKey: "oauth-device",
    componentPatterns: ["/oauth/device"],
    placement: "public",
    match: (parts, search) =>
      parts[0] === "oauth" && parts[1] === "device"
        ? { view: "oauth-device", oauthQuery: search }
        : undefined,
    build: (state) =>
      state.view === "oauth-device" ? buildOAuthDevicePath(state) : undefined,
  },
  {
    key: "terms",
    componentKey: "terms",
    componentPatterns: ["/terms"],
    placement: "public",
    match: (parts) =>
      parts[0] === "terms" ? { view: "legal", legalPage: "terms" } : undefined,
    build: (state) =>
      state.view === "legal" && state.legalPage === "terms"
        ? buildLegalPath(state)
        : undefined,
  },
  {
    key: "privacy",
    componentKey: "privacy",
    componentPatterns: ["/privacy"],
    placement: "public",
    match: (parts) =>
      parts[0] === "privacy"
        ? { view: "legal", legalPage: "privacy" }
        : undefined,
    build: (state) =>
      state.view === "legal" && state.legalPage === "privacy"
        ? buildLegalPath(state)
        : undefined,
  },
  {
    key: "tokushoho",
    componentKey: "tokushoho",
    componentPatterns: ["/legal/tokushoho"],
    placement: "public",
    match: (parts) =>
      parts[0] === "legal" && parts[1] === "tokushoho"
        ? { view: "legal", legalPage: "tokushoho" }
        : undefined,
    build: (state) =>
      state.view === "legal" && state.legalPage === "tokushoho"
        ? buildLegalPath(state)
        : undefined,
  },
  {
    key: "share",
    componentKey: "share",
    componentPatterns: ["/share/:token"],
    placement: "public",
    match: (parts) =>
      parts[0] === "share" && parts[1]
        ? { view: "share", shareToken: parts[1] }
        : undefined,
    build: (state) =>
      state.view === "share" ? buildSharePath(state) : undefined,
  },
  {
    key: "memory",
    componentKey: "memory",
    componentPatterns: ["/memory"],
    placement: "protected",
    match: (parts) => {
      const view =
        SIMPLE_TOP_LEVEL_VIEWS[parts[0] as keyof typeof SIMPLE_TOP_LEVEL_VIEWS];
      return view ? { view } : undefined;
    },
    build: (state) => state.view === "memory" ? "/memory" : undefined,
  },
  {
    key: "store",
    componentKey: "store",
    componentPatterns: [
      "/store/:storeTab?",
      "/source/:storeTab?",
      "/explore/:storeTab?",
    ],
    placement: "public",
    match: (parts) =>
      parts[0] === "store" || parts[0] === "source" || parts[0] === "explore"
        ? { view: "store", storeTab: normalizeStoreTab(parts[1]) }
        : undefined,
    build: (state) =>
      state.view === "store" ? buildStorePath(state) : undefined,
  },
  {
    key: "chat",
    componentKey: "chat",
    componentPatterns: [
      "/chat/:spaceId?/:threadId?",
      "/w/:spaceId",
      "/w/:spaceId/t/:threadId",
    ],
    placement: "protected",
    match: (parts) => {
      if (parts[0] === "chat") {
        if (parts[1] && parts[2]) {
          return { view: "chat", spaceId: parts[1], threadId: parts[2] };
        }
        if (parts[1]) {
          return { view: "chat", spaceId: parts[1] };
        }
        return { view: "chat" };
      }

      if (parts[0] !== "w" || !parts[1]) {
        return undefined;
      }
      if (parts.length === 2) {
        return { view: "chat", spaceId: parts[1], spaceSlug: parts[1] };
      }
      if (parts[2] === "t" && parts[3]) {
        return {
          view: "chat",
          spaceId: parts[1],
          spaceSlug: parts[1],
          threadId: parts[3],
        };
      }
      return undefined;
    },
    build: (state) => state.view === "chat" ? buildChatPath(state) : undefined,
  },
  {
    key: "repos",
    componentKey: "repos",
    componentPatterns: ["/repos/:spaceId?"],
    placement: "protected",
    match: (parts) => {
      if (parts[0] === "repos") {
        return parts[1]
          ? { view: "repos", spaceId: parts[1] }
          : { view: "repos" };
      }
      if (parts[0] === "w" && parts[1] && parts[2] === "repos" && !parts[3]) {
        return { view: "repos", spaceId: parts[1], spaceSlug: parts[1] };
      }
      return undefined;
    },
    build: (state) =>
      state.view === "repos" ? buildReposPath(state) : undefined,
  },
  {
    key: "groups",
    componentKey: "deploy",
    componentPatterns: [
      "/groups/:spaceId?/:groupId?",
      "/w/:spaceId/groups/:groupId?",
    ],
    placement: "protected",
    match: (parts) => {
      if (parts[0] === "groups") {
        return parts[1]
          ? {
            view: "deploy",
            spaceId: parts[1],
            deploySection: "groups",
            groupId: parts[2],
          }
          : { view: "deploy", deploySection: "groups" };
      }
      if (parts[0] === "w" && parts[1] && parts[2] === "groups") {
        return {
          view: "deploy",
          spaceId: parts[1],
          spaceSlug: parts[1],
          deploySection: "groups",
          groupId: parts[3],
        };
      }
      return undefined;
    },
    build: (state) =>
      state.view === "groups" ? buildGroupsPath(state) : undefined,
  },
  {
    key: "space-repo",
    componentKey: "space-repo",
    componentPatterns: ["/w/:spaceId/repos/:repoId"],
    placement: "public",
    match: (parts) =>
      parts[0] === "w" && parts[1] && parts[2] === "repos" && parts[3]
        ? {
          view: "repo",
          spaceId: parts[1],
          spaceSlug: parts[1],
          repoId: parts[3],
        }
        : undefined,
    build: (state) => state.view === "repo" ? buildRepoPath(state) : undefined,
  },
  {
    key: "storage",
    componentKey: "storage",
    componentPatterns: [
      "/storage",
      "/storage/:spaceId",
      "/storage/:spaceId/*storagePath",
      "/w/:spaceId/files",
      "/w/:spaceId/files/*storagePath",
    ],
    placement: "protected",
    match: (parts) => {
      if (parts[0] === "storage") {
        if (!parts[1]) {
          return { view: "storage" };
        }
        const storagePath = parts.length > 2
          ? `/${parts.slice(2).join("/")}`
          : "/";
        return { view: "storage", spaceId: parts[1], storagePath };
      }

      if (parts[0] === "w" && parts[1] && parts[2] === "files") {
        const storagePath = parts.length > 3
          ? `/${parts.slice(3).join("/")}`
          : "/";
        return {
          view: "storage",
          spaceId: parts[1],
          spaceSlug: parts[1],
          storagePath,
        };
      }

      return undefined;
    },
    build: (state) =>
      state.view === "storage" ? buildStoragePath(state) : undefined,
  },
  {
    key: "apps",
    componentKey: "apps",
    componentPatterns: ["/apps/:spaceId?"],
    placement: "protected",
    match: (parts) =>
      parts[0] === "apps"
        ? parts[1] ? { view: "apps", spaceId: parts[1] } : { view: "apps" }
        : undefined,
    build: (state) => state.view === "apps" ? buildAppsPath(state) : undefined,
  },
  {
    key: "deploy",
    componentKey: "deploy",
    componentPatterns: [
      "/deploy",
      "/deploy/:segment",
      "/deploy/:spaceId/:section?/:groupId?",
      "/deploy/w/:spaceId/:section?/:groupId?",
      "/resources",
      "/workers",
      "/deployments",
      "/services",
    ],
    placement: "protected",
    match: (parts) => {
      const aliasSection =
        DEPLOY_ALIAS_SECTIONS[parts[0] as keyof typeof DEPLOY_ALIAS_SECTIONS];
      if (aliasSection) {
        return { view: "deploy", deploySection: aliasSection };
      }

      if (parts[0] !== "deploy") {
        return undefined;
      }

      if (parts[1] === "w") {
        if (parts[2]) {
          const deploySection = parseDeploySection(parts[3]) || "workers";
          return {
            view: "deploy",
            spaceId: parts[2],
            deploySection,
            groupId: deploySection === "groups" ? parts[4] : undefined,
          };
        }
        return { view: "deploy", deploySection: "workers" };
      }

      const maybeSection = parseDeploySection(parts[1]);
      if (maybeSection) {
        return {
          view: "deploy",
          deploySection: maybeSection,
          groupId: maybeSection === "groups" ? parts[2] : undefined,
        };
      }

      if (parts[1]) {
        const deploySection = parseDeploySection(parts[2]) || "workers";
        return {
          view: "deploy",
          spaceId: parts[1],
          deploySection,
          groupId: deploySection === "groups" ? parts[3] : undefined,
        };
      }

      return { view: "deploy", deploySection: "workers" };
    },
    build: (state) =>
      state.view === "deploy" ? buildDeployPath(state) : undefined,
  },
  {
    key: "settings",
    componentKey: "settings",
    componentPatterns: ["/settings"],
    placement: "protected",
    match: (parts) =>
      parts[0] === "settings" ? { view: "settings" } : undefined,
    build: (state) => state.view === "settings" ? "/settings" : undefined,
  },
  {
    key: "space-settings",
    componentKey: "space-settings",
    componentPatterns: ["/space-settings/:spaceId?"],
    placement: "protected",
    match: (parts) =>
      parts[0] === "space-settings"
        ? { view: "space-settings", spaceId: parts[1] }
        : undefined,
    build: (state) =>
      state.view === "space-settings"
        ? state.spaceId ? `/space-settings/${state.spaceId}` : "/space-settings"
        : undefined,
  },
  {
    key: "profile",
    componentKey: "profile",
    componentPatterns: ["/@:username"],
    placement: "protected",
    match: (parts) =>
      parts[0]?.startsWith("@")
        ? { view: "profile", username: parts[0].slice(1) }
        : undefined,
    build: (state) =>
      state.view === "profile" ? buildProfilePath(state) : undefined,
  },
  {
    key: "legacy-app-store",
    componentKey: "legacy-app-store",
    componentPatterns: ["/app/store"],
    placement: "protected",
    match: (parts) =>
      parts[0] === "app" && parts[1] === "store"
        ? { view: "store", storeTab: "discover" }
        : undefined,
  },
  {
    key: "legacy-app-repos",
    componentKey: "legacy-app-repos",
    componentPatterns: ["/app/repos"],
    placement: "protected",
    match: (parts) =>
      parts[0] === "app" && parts[1] === "repos"
        ? { view: "repos" }
        : undefined,
  },
  {
    key: "legacy-app-workers",
    componentKey: "legacy-app-workers",
    componentPatterns: ["/app/workers"],
    placement: "protected",
    match: (parts) =>
      parts[0] === "app" && parts[1] === "workers"
        ? { view: "deploy", deploySection: "workers" }
        : undefined,
  },
  {
    key: "legacy-app-resources",
    componentKey: "legacy-app-resources",
    componentPatterns: ["/app/resources"],
    placement: "protected",
    match: (parts) =>
      parts[0] === "app" && parts[1] === "resources"
        ? { view: "deploy", deploySection: "resources" }
        : undefined,
  },
  {
    key: "legacy-app",
    componentKey: "legacy-app",
    componentPatterns: ["/app/:appId"],
    placement: "protected",
    match: (parts) =>
      parts[0] === "app" && parts[1] && !parts[2]
        ? { view: "app", appId: parts[1] }
        : undefined,
    build: (state) => state.view === "app" ? buildAppPath(state) : undefined,
  },
  {
    key: "repo",
    componentKey: "repo",
    componentPatterns: ["/:username/:repoName"],
    placement: "public",
    match: (parts) =>
      parts[0] && parts[1] && !parts[0].startsWith("@") &&
        /^[a-zA-Z0-9_-]+$/.test(parts[0]) &&
        /^[a-zA-Z0-9_-]+$/.test(parts[1])
        ? {
          view: "repo",
          username: parts[0],
          repoName: parts[1],
        }
        : undefined,
  },
  {
    key: "home",
    componentKey: "home",
    componentPatterns: ["/", "*rest"],
    placement: "fallback",
    match: (parts) => (parts.length === 0 ? { view: "home" } : undefined),
    build: (state) => state.view === "home" ? "/" : undefined,
  },
];

function hasComponentRoute(
  schema: AppRouteSchema,
): schema is
  & AppRouteSchema
  & Required<Pick<AppRouteSchema, "componentKey" | "componentPatterns">> {
  return Boolean(schema.componentKey && schema.componentPatterns?.length);
}

function hasRouteBuilder(
  schema: AppRouteSchema,
): schema is AppRouteSchema & Required<Pick<AppRouteSchema, "build">> {
  return typeof schema.build === "function";
}

function filterComponentSchemas(placement: AppRoutePlacement) {
  return APP_ROUTE_SCHEMAS.filter((schema) =>
    schema.placement === placement && hasComponentRoute(schema)
  );
}

export const PUBLIC_APP_ROUTE_SCHEMAS = filterComponentSchemas("public");
export const PROTECTED_APP_ROUTE_SCHEMAS = filterComponentSchemas("protected");
export const FALLBACK_APP_ROUTE_SCHEMAS = filterComponentSchemas("fallback");

export function parseRouteFromSchema(
  pathname: string,
  search = "",
): RouteState {
  const parts = pathname.split("/").filter(Boolean);

  for (const schema of APP_ROUTE_SCHEMAS) {
    const route = schema.match(parts, search);
    if (route) {
      return applyRouteSearchParams(route, search);
    }
  }

  return applyRouteSearchParams({ view: "home" }, search);
}

export function buildRoutePathFromSchema(state: RouteState): string {
  for (const schema of APP_ROUTE_SCHEMAS) {
    if (!hasRouteBuilder(schema)) {
      continue;
    }
    const path = schema.build(state);
    if (path !== undefined) {
      return path;
    }
  }

  return "/";
}
