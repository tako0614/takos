import { Hono, type MiddlewareHandler } from "hono";
import type { Env, User } from "../../shared/types/index.ts";
import { validateContentType } from "../middleware/content-type.ts";
import {
  generalApiBodyLimit,
  searchBodyLimit,
} from "../middleware/body-size.ts";
import { billingGate, type BillingVariables } from "../middleware/billing.ts";
import { requireWeeklyRuntimeLimitForAgent } from "../middleware/plan-gates.ts";
import { validateApiOpaqueRouteParams } from "../middleware/param-validation.ts";
import spacesBase from "./spaces/routes.ts";
import spacesMembers from "./spaces/members.ts";
import spacesRepos from "./spaces/repositories.ts";
import spacesStorage from "./spaces/storage.ts";
import spacesStores from "./spaces/stores.ts";
import spacesStoreRegistry from "./spaces/store-registry.ts";
import spacesTools from "./spaces/tools.ts";
import seedRepositories from "./seed-repositories.ts";
import threads from "./threads.ts";
import runs from "./runs/routes.ts";
import search from "./search.ts";
import indexRoutes from "./index/routes.ts";
import memories from "./memories.ts";
import skills from "./skills.ts";
import services from "./workers/index.ts";
import customDomains from "./custom-domains.ts";
import resources from "./resources/index.ts";
import sessions from "./sessions/index.ts";
import git from "./git.ts";
import repos from "./repos/index.ts";
import pullRequests from "./pull-requests/index.ts";
import notifications from "./notifications.ts";
import explore from "./explore/index.ts";
import { profilesApi } from "./profiles/index.ts";
import { registerAppApiRoutes } from "./apps.ts";
import shortcuts, { shortcutGroupRoutes } from "./shortcuts.ts";
import me from "./me.ts";
import setup from "./setup.ts";
import agentTasks from "./agent-tasks.ts";
import authApi from "./auth-api.ts";
import billingRoutes, { billingWebhookHandler } from "./billing/routes.ts";
import publicShare from "./public-share.ts";
import mcpRoutes from "./mcp.ts";
import groupDeploymentSnapshots from "./group-deployment-snapshots.ts";
import oauthConsentApi from "./oauth-consent-api.ts";
import groupsRouter from "./groups.ts";
import publications from "./publications/routes.ts";
import { createRunSseRouter } from "./runs/sse.ts";
import { createNotificationSseRouter } from "./notifications-sse.ts";
import { createEventsRouter } from "./events/routes.ts";
import { workersSpaceRoutes } from "./workers/routes.ts";
import { requireAnyAuth } from "../middleware/oauth-auth.ts";
// Local type to mirror app Variables
export type ApiVariables = BillingVariables & {
  user?: User;
};

type ApiAuthMiddleware = MiddlewareHandler<
  { Bindings: Env; Variables: ApiVariables }
>;

// ---------------------------------------------------------------------------
// Middleware ordering helpers
// ---------------------------------------------------------------------------

/**
 * Runtime assertion: ensures `c.get('user')` has been set by a prior auth
 * middleware. This converts a silent ordering bug into a loud 500 error
 * during development.  Read-only methods are exempt because billing/plan
 * gates already short-circuit for them.
 */
const READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function assertAuthRan(label: string): ApiAuthMiddleware {
  return async (c, next) => {
    if (!READ_ONLY_METHODS.has(c.req.method.toUpperCase()) && !c.get("user")) {
      throw new Error(
        `Middleware ordering error: requireAuth must run before ${label}`,
      );
    }
    await next();
  };
}

/** Register an ordered chain of middleware handlers on a single route pattern. */
function useChain(
  router: Hono<{ Bindings: Env; Variables: ApiVariables }>,
  pattern: string,
  handlers: ApiAuthMiddleware[],
) {
  for (const handler of handlers) {
    router.use(pattern, handler);
  }
}

/**
 * Pre-built middleware chains for common access patterns.
 * Using named arrays makes the ordering explicit and prevents
 * accidental re-ordering when individual `.use()` calls are added
 * or moved.
 */
function buildMiddlewareChains(
  billingOpts: { shadow: boolean },
) {
  // --- Billing / plan gates (must always follow requireAuth) ---
  const vectorSearchGate: ApiAuthMiddleware[] = [
    assertAuthRan("billingGate(vector_search_count)"),
    billingGate("vector_search_count", 1, billingOpts),
  ];

  const embeddingGate: ApiAuthMiddleware[] = [
    assertAuthRan("billingGate(embedding_count)"),
    billingGate("embedding_count", 1, billingOpts),
  ];

  const execSecondsGate: ApiAuthMiddleware[] = [
    assertAuthRan("billingGate(exec_seconds)"),
    billingGate("exec_seconds", 1, billingOpts),
  ];

  const wfpRequestsGate: ApiAuthMiddleware[] = [
    assertAuthRan("billingGate(wfp_requests)"),
    billingGate("wfp_requests", 1, billingOpts),
  ];

  const weeklyRuntimeGate = requireWeeklyRuntimeLimitForAgent();
  const agentGates: ApiAuthMiddleware[] = [
    assertAuthRan("weeklyRuntimeGate / billingGate(llm_tokens_input)"),
    weeklyRuntimeGate,
    billingGate("llm_tokens_input", 1000, billingOpts),
  ];

  return {
    vectorSearchGate,
    embeddingGate,
    execSecondsGate,
    wfpRequestsGate,
    agentGates,
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
  const billingOpts = { shadow: false };
  const {
    vectorSearchGate,
    embeddingGate,
    execSecondsGate,
    wfpRequestsGate,
    agentGates,
  } = buildMiddlewareChains(billingOpts);

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
      "/me/oauth/consents/:clientId",
      "/me/oauth/clients/:clientId",
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

  apiRouter.use("/explore/*", optionalAuth);
  apiRouter.route("/explore", explore);

  apiRouter.use("/users/*", optionalAuth);
  apiRouter.route("/users", profilesApi);

  // Public share routes (no auth required)
  // Note: share views are read-only and sanitized by default.
  apiRouter.route("/public", publicShare);

  // MCP management routes (authenticated)
  apiRouter.use("/mcp/servers", requireAuth);
  apiRouter.use("/mcp/servers/*", requireAuth);

  // MCP OAuth callback/public routes + authenticated management routes
  apiRouter.route("/mcp", mcpRoutes);

  // OAuth-enabled auth for storage routes (must run before generic requireAuth)
  // Sets user from OAuth Bearer token so requireAuth passes through.
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
  // 4. Protected routes — requireAuth
  //    These MUST be registered before the billing/plan gates below.
  // ================================================================
  apiRouter.use("/me", requireAuth);
  apiRouter.use("/me/*", requireAuth);
  apiRouter.use("/spaces", requireAuth);
  apiRouter.use("/spaces/*", requireAuth);
  apiRouter.use("/threads", requireAuth);
  apiRouter.use("/threads/*", requireAuth);
  apiRouter.use("/runs", requireAuth);
  apiRouter.use("/runs/*", requireAuth);
  apiRouter.use("/artifacts", requireAuth);
  apiRouter.use("/artifacts/*", requireAuth);
  apiRouter.use("/memories", requireAuth);
  apiRouter.use("/memories/*", requireAuth);
  apiRouter.use("/reminders", requireAuth);
  apiRouter.use("/reminders/*", requireAuth);
  apiRouter.use("/skills", requireAuth);
  apiRouter.use("/skills/*", requireAuth);
  apiRouter.use("/services", requireAuth);
  apiRouter.use("/services/*", requireAuth);
  apiRouter.use("/deployments", requireAuth);
  apiRouter.use("/deployments/*", requireAuth);
  apiRouter.use("/resources", requireAuth);
  apiRouter.use("/resources/*", requireAuth);
  apiRouter.use("/apps", requireAuth);
  apiRouter.use("/apps/*", requireAuth);
  apiRouter.use("/publications", requireAuth);
  apiRouter.use("/publications/*", requireAuth);
  apiRouter.use("/sessions", requireAuth);
  apiRouter.use("/sessions/*", requireAuth);
  apiRouter.use("/repos", requireAuth);
  apiRouter.use("/repos/*", requireAuth);
  apiRouter.use("/git", requireAuth);
  apiRouter.use("/git/*", requireAuth);
  apiRouter.use("/agent-tasks", requireAuth);
  apiRouter.use("/agent-tasks/*", requireAuth);
  apiRouter.use("/setup", requireAuth);
  apiRouter.use("/setup/*", requireAuth);
  apiRouter.use("/shortcuts", requireAuth);
  apiRouter.use("/shortcuts/*", requireAuth);
  apiRouter.use("/notifications", requireAuth);
  apiRouter.use("/notifications/*", requireAuth);

  // ================================================================
  // 5. Billing / plan gates (MUST follow section 4)
  //    Each gate chain begins with assertAuthRan() — a runtime check
  //    that throws if requireAuth has not yet populated c.get('user').
  //    This prevents silent ordering bugs when middleware is rearranged.
  // ================================================================

  // -- Vector search billing gate --
  useChain(apiRouter, "/spaces/:spaceId/search", vectorSearchGate);

  // -- Embedding billing gate --
  useChain(apiRouter, "/spaces/:spaceId/index", embeddingGate);
  useChain(apiRouter, "/spaces/:spaceId/index/*", embeddingGate);

  // -- Session execution billing gate --
  useChain(apiRouter, "/sessions", execSecondsGate);
  useChain(apiRouter, "/sessions/*", execSecondsGate);

  // -- Service / WFP billing gate --
  useChain(apiRouter, "/services", wfpRequestsGate);
  useChain(apiRouter, "/services/*", wfpRequestsGate);
  useChain(apiRouter, "/spaces/:spaceId/services", wfpRequestsGate);

  // -- AI agent usage gates --
  // Metered with:
  //   1) shared rolling runtime limit (7d/5h)
  //   2) token preflight billing check
  const agentRoutePatterns = [
    "/spaces/:spaceId/threads",
    "/spaces/:spaceId/threads/*",
    "/threads",
    "/threads/*",
    "/runs",
    "/runs/*",
    "/spaces/:spaceId/agent-tasks",
    "/spaces/:spaceId/agent-tasks/*",
    "/agent-tasks",
    "/agent-tasks/*",
  ] as const;

  for (const pattern of agentRoutePatterns) {
    useChain(apiRouter, pattern, agentGates);
  }

  // ================================================================
  // 6. Route mounting
  // ================================================================
  apiRouter.route("/setup", setup);
  apiRouter.route("/me", me);
  apiRouter.route("/spaces", spacesBase);
  apiRouter.route("/spaces", spacesMembers);
  apiRouter.route("/spaces", spacesRepos);
  apiRouter.route("/spaces", spacesStorage);
  apiRouter.route("/spaces", spacesStores);
  apiRouter.route("/spaces", spacesStoreRegistry);
  apiRouter.route("/spaces", spacesTools);
  apiRouter.route("/spaces", workersSpaceRoutes);
  apiRouter.route("/", seedRepositories);
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
  apiRouter.route("/", git); // Git routes for version control
  apiRouter.route("/", repos); // Repository management routes
  apiRouter.route("/", agentTasks); // Agent task routes
  apiRouter.route("/", notifications); // Notifications routes at /api/notifications
  apiRouter.route("/notifications", createNotificationSseRouter()); // SSE route at /api/notifications/sse (Node.js WebSocket alternative)
  apiRouter.route("/events", createEventsRouter()); // SSE route at /api/events for space lifecycle events (auth handled internally)
  apiRouter.route("/", pullRequests); // Pull request routes for code review
  apiRouter.route("/", groupDeploymentSnapshots); // Group deployment snapshot routes at /api/spaces/:id/group-deployment-snapshots
  apiRouter.route("/", groupsRouter); // Group management routes at /api/spaces/:id/groups
  apiRouter.route("/publications", publications); // Publications discovery API at /api/publications
  // ================================================================
  // 7. Billing routes (webhook is public; management is authenticated)
  // ================================================================

  // Webhook uses Stripe signature verification — no session auth
  apiRouter.route("/billing/webhook", billingWebhookHandler);

  // Management endpoints — enumerate paths to avoid catching webhook
  apiRouter.use("/billing", requireAuth);
  apiRouter.use("/billing/usage", requireAuth);
  apiRouter.use("/billing/subscribe", requireAuth);
  apiRouter.use("/billing/credits/checkout", requireAuth);
  apiRouter.use("/billing/portal", requireAuth);
  apiRouter.use("/billing/invoices", requireAuth);
  apiRouter.use("/billing/invoices/*", requireAuth);
  apiRouter.route("/billing", billingRoutes);

  // ================================================================
  // 8. Auth routes (login is public, others require auth)
  // ================================================================
  apiRouter.use("/auth/me", requireAuth);
  apiRouter.use("/auth/setup-password", requireAuth);
  apiRouter.use("/auth/setup-username", requireAuth);
  apiRouter.use("/auth/profile", requireAuth);
  apiRouter.use("/auth/logout", requireAuth);
  apiRouter.route("/auth", authApi);

  // ================================================================
  // 9. OAuth consent API (session-cookie auth, consumed by the SPA)
  // ================================================================
  apiRouter.route("/oauth", oauthConsentApi);

  return apiRouter;
}
