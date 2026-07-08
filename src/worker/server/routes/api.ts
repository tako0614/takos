import { Hono, type MiddlewareHandler } from "hono";
import type { Env, User } from "../../shared/types/index.ts";
import { validateContentType } from "../middleware/content-type.ts";
import {
  generalApiBodyLimit,
  searchBodyLimit,
} from "../middleware/body-size.ts";
import { validateApiOpaqueRouteParams } from "../middleware/param-validation.ts";
import spacesBase from "./spaces/routes.ts";
import spacesMembers from "./spaces/members.ts";
import spacesRepos from "./spaces/repositories.ts";
import spacesStorage from "./spaces/storage.ts";
import spacesTools from "./spaces/tools.ts";
import threads from "./threads.ts";
import runs from "./runs/routes.ts";
import search from "./search/index.ts";
import indexRoutes from "./index/routes.ts";
import memories from "./memories/index.ts";
import skills from "./skills.ts";
import services from "./workers/index.ts";
import customDomains from "./custom-domains.ts";
import resources from "./resources/index.ts";
import sessions from "./sessions/index.ts";
import repos from "./repos/index.ts";
import pullRequests from "./pull-requests/index.ts";
import notifications from "./notifications/index.ts";
import mobile from "./mobile.ts";
import { registerAppApiRoutes } from "./apps/index.ts";
import shortcuts, { shortcutGroupRoutes } from "./shortcuts/index.ts";
import me from "./me/index.ts";
import setup from "./setup.ts";
import agentTasks from "./agent-tasks/index.ts";
import authApi from "./auth-api.ts";
import publicShare from "./public-share/index.ts";
import mcpRoutes from "./mcp/index.ts";
import groupsRouter from "./groups.ts";
import appInstallationsRouter from "./app-installations.ts";
import { createRunSseRouter } from "./runs/sse.ts";
import { createNotificationSseRouter } from "./notifications/index.ts";
import { createEventsRouter } from "./events/routes.ts";
import { workersSpaceRoutes } from "./workers/routes.ts";
import {
  extractBearerToken,
  isTakosumiAccountsBearerCandidate,
} from "../middleware/bearer-token-classification.ts";
import { requireAnyAuth } from "../middleware/oauth-auth.ts";
// Local type to mirror app Variables
export type ApiVariables = {
  user?: User;
};

type ApiAuthMiddleware = MiddlewareHandler<
  { Bindings: Env; Variables: ApiVariables }
>;

// ---------------------------------------------------------------------------
// Middleware ordering helpers
// ---------------------------------------------------------------------------

/**
 * Scope resolution treats unsafe methods as write operations.
 */
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function normalizeApiPath(pathname: string): string {
  if (pathname === "/api") return "/";
  if (pathname.startsWith("/api/")) return pathname.slice("/api".length);
  return pathname;
}

function pathMatches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isSpaceScopedFamily(pathname: string, family: string): boolean {
  return new RegExp(`^/spaces/[^/]+/${family}(?:/|$)`).test(pathname);
}

function readWriteScope(
  c: Parameters<ApiAuthMiddleware>[0],
  readScope: string,
  writeScope: string,
): string[] {
  return [
    WRITE_METHODS.has(c.req.method.toUpperCase()) ? writeScope : readScope,
  ];
}

function requiredApiScopesForRequest(
  c: Parameters<ApiAuthMiddleware>[0],
): string[] | undefined {
  const pathname = normalizeApiPath(new URL(c.req.url).pathname);

  if (
    pathMatches(pathname, "/threads") ||
    isSpaceScopedFamily(pathname, "threads")
  ) {
    return readWriteScope(c, "threads:read", "threads:write");
  }
  if (
    pathMatches(pathname, "/runs") ||
    pathMatches(pathname, "/artifacts") ||
    new RegExp("^/threads/[^/]+/runs(?:/|$)").test(pathname)
  ) {
    return readWriteScope(c, "runs:read", "runs:write");
  }
  if (
    pathMatches(pathname, "/agent-tasks") ||
    isSpaceScopedFamily(pathname, "agent-tasks")
  ) {
    return ["agents:execute"];
  }
  if (
    pathMatches(pathname, "/memories") ||
    pathMatches(pathname, "/reminders") ||
    isSpaceScopedFamily(pathname, "memories") ||
    isSpaceScopedFamily(pathname, "reminders")
  ) {
    return readWriteScope(c, "memories:read", "memories:write");
  }
  if (
    pathMatches(pathname, "/repos") ||
    isSpaceScopedFamily(pathname, "repos") ||
    isSpaceScopedFamily(pathname, "repositories")
  ) {
    return readWriteScope(c, "repos:read", "repos:write");
  }
  if (pathMatches(pathname, "/mcp/servers")) {
    return ["mcp:invoke"];
  }
  if (
    pathMatches(pathname, "/me") ||
    pathMatches(pathname, "/auth") ||
    pathMatches(pathname, "/mobile") ||
    pathMatches(pathname, "/notifications")
  ) {
    return ["profile"];
  }

  // Storage has per-route files:read/files:write checks in the storage router.
  if (isSpaceScopedFamily(pathname, "storage")) return undefined;

  if (
    pathMatches(pathname, "/spaces") ||
    pathMatches(pathname, "/services") ||
    pathMatches(pathname, "/deployments") ||
    pathMatches(pathname, "/resources") ||
    pathMatches(pathname, "/apps") ||
    pathMatches(pathname, "/sessions") ||
    pathMatches(pathname, "/setup") ||
    pathMatches(pathname, "/shortcuts") ||
    pathMatches(pathname, "/skills") ||
    isSpaceScopedFamily(pathname, "search") ||
    isSpaceScopedFamily(pathname, "index") ||
    isSpaceScopedFamily(pathname, "graph") ||
    isSpaceScopedFamily(pathname, "tools") ||
    isSpaceScopedFamily(pathname, "services") ||
    isSpaceScopedFamily(pathname, "skills") ||
    isSpaceScopedFamily(pathname, "shortcuts") ||
    isSpaceScopedFamily(pathname, "groups")
  ) {
    return readWriteScope(c, "spaces:read", "spaces:write");
  }

  return undefined;
}

function getBearerToken(c: Parameters<ApiAuthMiddleware>[0]): string | null {
  return extractBearerToken(c.req.header("Authorization"));
}

function createScopedApiAuth(
  fallbackAuth: ApiAuthMiddleware,
): ApiAuthMiddleware {
  return async (c, next) => {
    const bearerToken = getBearerToken(c);
    if (!bearerToken || !isTakosumiAccountsBearerCandidate(bearerToken)) {
      return await fallbackAuth(c, next);
    }

    const requiredScopes = requiredApiScopesForRequest(c);
    return await (requireAnyAuth(requiredScopes) as ApiAuthMiddleware)(c, next);
  };
}

export function createApiRouter({
  requireAuth,
  optionalAuth,
}: {
  requireAuth: ApiAuthMiddleware;
  optionalAuth: ApiAuthMiddleware;
}) {
  const apiRouter = new Hono<{ Bindings: Env; Variables: ApiVariables }>();
  const scopedApiAuth = createScopedApiAuth(requireAuth);

  // ================================================================
  // 1. Global middleware (runs on every request)
  // ================================================================

  // Content-Type validation: accepts JSON, form data, and multipart
  apiRouter.use(
    "*",
    validateContentType({
      allowedTypes: [
        "application/json",
        "application/x-www-form-urlencoded",
        "multipart/form-data",
      ],
      allowEmptyBody: true,
    }),
  );

  // Global body size limit for API endpoints (1MB)
  // Note: File upload endpoints may need higher limits
  apiRouter.use("*", generalApiBodyLimit);

  // ================================================================
  // 2. Parameter validation (runs before auth)
  // ================================================================

  // Reject malformed opaque IDs before they can reach lookup queries.
  for (
    const pattern of [
      "/spaces/:spaceId",
      "/spaces/:spaceId/*",
      "/threads/:id",
      "/threads/:id/*",
      "/runs/:id",
      "/runs/:id/*",
      "/artifacts/:id",
      "/artifacts/:id/*",
      "/repos/:id",
      "/repos/:id/*",
      "/services/:id",
      "/services/:id/*",
      "/resources/:id",
      "/resources/:id/*",
      "/sessions/:id",
      "/sessions/:id/*",
      "/agent-tasks/:id",
      "/agent-tasks/:id/*",
      "/apps/:id",
      "/apps/:id/*",
      "/notifications/:id",
      "/notifications/:id/*",
    ]
  ) {
    apiRouter.use(pattern, validateApiOpaqueRouteParams);
  }

  // Apply stricter body size limit for search endpoints (256KB)
  apiRouter.use("/spaces/:spaceId/search", searchBodyLimit);
  apiRouter.use("/spaces/:spaceId/search/*", searchBodyLimit);

  // ================================================================
  // 3. Public / optional-auth routes
  // ================================================================

  // Public share routes (no auth required)
  // Note: share views are read-only and sanitized by default.
  apiRouter.route("/public", publicShare);

  // MCP management routes (authenticated)
  apiRouter.use("/mcp/servers", scopedApiAuth);
  apiRouter.use("/mcp/servers/*", scopedApiAuth);

  // MCP OAuth callback/public routes + authenticated management routes
  apiRouter.route("/mcp", mcpRoutes);

  // Scoped bearer auth for storage routes (must run before generic requireAuth).
  // Sets user from scoped Takosumi Accounts bearer credentials so requireAuth
  // passes through.
  // Scope checking is done per-route in the storage route handler.
  apiRouter.use(
    "/spaces/:spaceId/storage",
    requireAnyAuth() as ApiAuthMiddleware,
  );
  apiRouter.use(
    "/spaces/:spaceId/storage/*",
    requireAnyAuth() as ApiAuthMiddleware,
  );

  // ================================================================
  // 4. Protected routes — browser/container auth or scoped bearer auth.
  // ================================================================
  apiRouter.use("/me", scopedApiAuth);
  apiRouter.use("/me/*", scopedApiAuth);
  apiRouter.use("/spaces", scopedApiAuth);
  apiRouter.use("/spaces/*", scopedApiAuth);
  apiRouter.use("/threads", scopedApiAuth);
  apiRouter.use("/threads/*", scopedApiAuth);
  apiRouter.use("/runs", scopedApiAuth);
  apiRouter.use("/runs/*", scopedApiAuth);
  apiRouter.use("/artifacts", scopedApiAuth);
  apiRouter.use("/artifacts/*", scopedApiAuth);
  apiRouter.use("/memories", scopedApiAuth);
  apiRouter.use("/memories/*", scopedApiAuth);
  apiRouter.use("/reminders", scopedApiAuth);
  apiRouter.use("/reminders/*", scopedApiAuth);
  apiRouter.use("/skills", scopedApiAuth);
  apiRouter.use("/skills/*", scopedApiAuth);
  apiRouter.use("/services", scopedApiAuth);
  apiRouter.use("/services/*", scopedApiAuth);
  apiRouter.use("/deployments", scopedApiAuth);
  apiRouter.use("/deployments/*", scopedApiAuth);
  apiRouter.use("/resources", scopedApiAuth);
  apiRouter.use("/resources/*", scopedApiAuth);
  apiRouter.use("/apps", scopedApiAuth);
  apiRouter.use("/apps/*", scopedApiAuth);
  apiRouter.use("/sessions", scopedApiAuth);
  apiRouter.use("/sessions/*", scopedApiAuth);
  apiRouter.use("/repos", scopedApiAuth);
  apiRouter.use("/repos/*", scopedApiAuth);
  apiRouter.use("/agent-tasks", scopedApiAuth);
  apiRouter.use("/agent-tasks/*", scopedApiAuth);
  apiRouter.use("/setup", scopedApiAuth);
  apiRouter.use("/setup/*", scopedApiAuth);
  apiRouter.use("/shortcuts", scopedApiAuth);
  apiRouter.use("/shortcuts/*", scopedApiAuth);
  apiRouter.use("/notifications", scopedApiAuth);
  apiRouter.use("/notifications/*", scopedApiAuth);
  apiRouter.use("/mobile", scopedApiAuth);
  apiRouter.use("/mobile/*", scopedApiAuth);

  // Commercial billing policy is enforced by Takosumi Accounts/Cloud. The
  // Takos app router intentionally does not mount local billing or plan gates.

  // ================================================================
  // 5. Route mounting
  // ================================================================
  apiRouter.route("/setup", setup);
  apiRouter.route("/me", me);
  apiRouter.route("/spaces", spacesBase);
  apiRouter.route("/spaces", spacesMembers);
  apiRouter.route("/spaces", spacesRepos);
  apiRouter.route("/spaces", spacesStorage);
  apiRouter.route("/spaces", spacesTools);
  apiRouter.route("/spaces", workersSpaceRoutes);
  apiRouter.route("/shortcuts", shortcuts);
  apiRouter.route("/", shortcutGroupRoutes); // Shortcut groups at /api/spaces/:id/shortcuts/groups
  apiRouter.route("/services", services);
  apiRouter.route("/", customDomains);
  apiRouter.route("/resources", resources);
  registerAppApiRoutes(apiRouter);
  apiRouter.route("/", threads); // Threads routes at /api/spaces/:id/threads and /api/threads/:id
  apiRouter.route("/", runs); // Runs routes at /api/threads/:id/runs, /api/runs/:id, and /api/artifacts/:id
  apiRouter.route("/runs", createRunSseRouter()); // SSE route at /api/runs/:id/sse (Node.js WebSocket alternative)
  apiRouter.route("/", search); // Search routes at /api/spaces/:id/search
  apiRouter.route("/", indexRoutes); // Index routes at /api/spaces/:id/index and /api/spaces/:id/graph
  apiRouter.route("/", memories); // Memory routes for memories and reminders
  apiRouter.route("/", skills); // Skills routes
  apiRouter.route("/", sessions); // Session routes for Space File Sync
  apiRouter.route("/", repos); // Repository management routes
  apiRouter.route("/", agentTasks); // Agent task routes
  apiRouter.route("/", notifications); // Notifications routes at /api/notifications
  apiRouter.route("/mobile", mobile);
  apiRouter.route("/notifications", createNotificationSseRouter()); // SSE route at /api/notifications/sse (Node.js WebSocket alternative)
  apiRouter.route("/events", createEventsRouter()); // SSE route at /api/events for space lifecycle events (auth handled internally). NOTE: subscribe side is wired; the group lifecycle producer (emitGroupLifecycleEvent) is not yet called from the deploy engine, so the stream is currently empty — see events/routes.ts.
  apiRouter.route("/", pullRequests); // Pull request routes for code review
  apiRouter.route("/", appInstallationsRouter); // Installation-backed app install routes
  apiRouter.route("/", groupsRouter); // Read-only runtime group inventory at /api/spaces/:id/groups
  // ================================================================
  // 7. Auth routes (login is public, others require auth)
  // ================================================================
  apiRouter.use("/auth/me", scopedApiAuth);
  apiRouter.use("/auth/setup-password", scopedApiAuth);
  apiRouter.use("/auth/profile", scopedApiAuth);
  apiRouter.use("/auth/logout", scopedApiAuth);
  apiRouter.route("/auth", authApi);

  return apiRouter;
}
