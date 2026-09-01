import type { RouteState, View } from "./types/index.ts";

type RouteParts = string[];
type RouteMatch = (parts: RouteParts, search: string) => RouteState | undefined;
type RouteBuild = (state: RouteState) => string | undefined;

export type AppRouteComponentKey =
  | "terms"
  | "privacy"
  | "security"
  | "tokushoho"
  | "share"
  | "store"
  | "chat"
  | "storage"
  | "apps"
  | "connections"
  | "notifications"
  | "memory"
  | "settings"
  | "space-settings"
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
  notifications: "notifications",
} as const satisfies Partial<Record<string, View>>;

const LEGAL_PAGE_TO_PATH = new Map<string, string>([
  ["terms", "/terms"],
  ["privacy", "/privacy"],
  ["security", "/security"],
  ["tokushoho", "/legal/tokushoho"],
]);

export function normalizeStoreTab(value?: string): "discover" | "installed" {
  return value === "installed" ? "installed" : "discover";
}

export function getRouteParentPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 1) return "/";
  return `/${parts.slice(0, -1).join("/")}`;
}

function appendSearchParams(pathname: string, params: URLSearchParams): string {
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

  if (route.view === "storage") {
    const explicitFilePath = params.get("file") || undefined;
    const shouldOpenCurrentPath = params.get("open") === "1";
    const filePath =
      explicitFilePath ||
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

  if (route.view === "connections") {
    const connectionServer = params.get("server")?.trim() || undefined;
    return connectionServer ? { ...route, connectionServer } : route;
  }

  if (route.view === "store") {
    const spaceId = params.get("space")?.trim() || undefined;
    return spaceId ? { ...route, spaceId } : route;
  }

  return route;
}

function buildLegalPath(state: RouteState): string {
  return LEGAL_PAGE_TO_PATH.get(state.legalPage ?? "") ?? "/terms";
}

function buildSharePath(state: RouteState): string {
  return state.shareToken ? `/share/${state.shareToken}` : "/";
}

function buildStorePath(state: RouteState): string {
  const pathname = state.storeTab && state.storeTab !== "discover"
    ? `/store/${state.storeTab}`
    : "/store";
  const params = new URLSearchParams();
  if (state.spaceId) params.set("space", state.spaceId);
  return appendSearchParams(pathname, params);
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

function buildAppsPath(state: RouteState): string {
  if (state.spaceId) {
    return `/apps/${state.spaceId}`;
  }
  return "/apps";
}

function buildConnectionsPath(state: RouteState): string {
  if (state.connectionServer) {
    const params = new URLSearchParams({ server: state.connectionServer });
    const path = state.spaceId
      ? `/connections/${state.spaceId}`
      : "/connections/new";
    return appendSearchParams(path, params);
  }
  if (state.spaceId) {
    return `/connections/${state.spaceId}`;
  }
  return "/connections";
}

function buildStoragePath(state: RouteState): string {
  const params = new URLSearchParams();
  const effectivePath = state.filePath || state.storagePath;
  if (state.filePath) {
    params.set("open", "1");
  }

  if (state.spaceId) {
    const basePath =
      effectivePath && effectivePath !== "/"
        ? `/storage/${state.spaceId}${effectivePath}`
        : `/storage/${state.spaceId}`;
    return appendSearchParams(basePath, params);
  }

  return "/storage";
}

export const APP_ROUTE_SCHEMAS: readonly AppRouteSchema[] = [
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
    key: "security",
    componentKey: "security",
    componentPatterns: ["/security"],
    placement: "public",
    match: (parts) =>
      parts[0] === "security"
        ? { view: "legal", legalPage: "security" }
        : undefined,
    build: (state) =>
      state.view === "legal" && state.legalPage === "security"
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
    build: (state) => (state.view === "memory" ? "/memory" : undefined),
  },
  {
    key: "notifications",
    componentKey: "notifications",
    componentPatterns: ["/notifications"],
    placement: "protected",
    match: (parts) => {
      const view =
        SIMPLE_TOP_LEVEL_VIEWS[parts[0] as keyof typeof SIMPLE_TOP_LEVEL_VIEWS];
      return view === "notifications" ? { view } : undefined;
    },
    build: (state) =>
      state.view === "notifications" ? "/notifications" : undefined,
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
    build: (state) =>
      state.view === "chat" ? buildChatPath(state) : undefined,
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
        const storagePath =
          parts.length > 2 ? `/${parts.slice(2).join("/")}` : "/";
        return { view: "storage", spaceId: parts[1], storagePath };
      }

      if (parts[0] === "w" && parts[1] && parts[2] === "files") {
        const storagePath =
          parts.length > 3 ? `/${parts.slice(3).join("/")}` : "/";
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
        ? parts[1]
          ? { view: "apps", spaceId: parts[1] }
          : { view: "apps" }
        : undefined,
    build: (state) =>
      state.view === "apps" ? buildAppsPath(state) : undefined,
  },
  {
    key: "connections",
    componentKey: "connections",
    componentPatterns: ["/connections/new", "/connections/:spaceId?"],
    placement: "protected",
    match: (parts) => {
      if (parts[0] !== "connections") return undefined;
      if (parts[1] === "new") return { view: "connections" };
      return parts[1]
        ? { view: "connections", spaceId: parts[1] }
        : { view: "connections" };
    },
    build: (state) =>
      state.view === "connections" ? buildConnectionsPath(state) : undefined,
  },
  {
    key: "settings",
    componentKey: "settings",
    componentPatterns: ["/settings"],
    placement: "protected",
    match: (parts) =>
      parts[0] === "settings" ? { view: "settings" } : undefined,
    build: (state) => (state.view === "settings" ? "/settings" : undefined),
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
        ? state.spaceId
          ? `/space-settings/${state.spaceId}`
          : "/space-settings"
        : undefined,
  },
  {
    key: "retired-app-shortcuts",
    match: (parts) => (parts[0] === "app" ? { view: "home" } : undefined),
  },
  {
    key: "home",
    componentKey: "home",
    componentPatterns: ["/", "*rest"],
    placement: "fallback",
    match: (parts) => (parts.length === 0 ? { view: "home" } : undefined),
    build: (state) => (state.view === "home" ? "/" : undefined),
  },
];

function hasComponentRoute(
  schema: AppRouteSchema,
): schema is AppRouteSchema &
  Required<Pick<AppRouteSchema, "componentKey" | "componentPatterns">> {
  return Boolean(schema.componentKey && schema.componentPatterns?.length);
}

function hasRouteBuilder(
  schema: AppRouteSchema,
): schema is AppRouteSchema & Required<Pick<AppRouteSchema, "build">> {
  return typeof schema.build === "function";
}

function filterComponentSchemas(placement: AppRoutePlacement) {
  return APP_ROUTE_SCHEMAS.filter(
    (schema) => schema.placement === placement && hasComponentRoute(schema),
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
