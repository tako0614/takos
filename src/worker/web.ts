// Canonical entrypoint for the main takos worker.
// Keep worker-only fetch/scheduled wiring here and shared logic in neutral modules.
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env, User } from "./shared/types/index.ts";
import type {
  PlatformExecutionContext,
  PlatformScheduledController,
} from "./shared/types/bindings.ts";
import { createApiRouter } from "./server/routes/api.ts";
import { RateLimiters } from "./shared/utils/rate-limiter.ts";
import { authSessionRouter } from "./server/routes/auth/session.ts";
import { authOidcRouter } from "./server/routes/auth/oidc.ts";
import gitSmartHttp from "./server/routes/git-smart-http.ts";
import {
  TAKOSUMI_PRODUCT_CAPABILITIES_PATH,
  TAKOSUMI_WELL_KNOWN_PATH,
} from "takosumi-contract";
import {
  createTakosDistributionProductCapabilities,
  createTakosDistributionWellKnown,
  createTakosProductWellKnown,
} from "./server/routes/takosumi-discovery.ts";
import { runCommonEnvScheduledMaintenance } from "./application/services/common-env/index.ts";
import { dispatchScheduledComputeTriggers } from "./application/services/deployment/scheduled-triggers.ts";
import { triggerScheduledWorkflows } from "./application/services/actions/actions-triggers.ts";
import {
  runScheduledFamilyMaintenance,
  scheduledWorkflowWindowMinutes,
} from "./application/services/maintenance/scheduled-cron.ts";
import {
  clearFeaturedAppCatalogEntries,
  getFeaturedAppReconcileStatus,
  hasFeaturedAppCatalogEnvOverride,
  isFeaturedAppCatalogInvalidError,
  saveFeaturedAppCatalogEntries,
} from "./application/services/source/featured-app-catalog.ts";
import { optionalAuth, requireAuth } from "./server/middleware/auth.ts";
import { staticAssetsMiddleware } from "./server/middleware/static-assets.ts";
import {
  isAllowedOrigin,
  isSelfHostInternalHostname,
  isSelfHostLoopback,
  validateInternalApiAccess,
} from "./server/middleware/internal-access.ts";
import { isInvalidArrayBufferError } from "./shared/utils/db-guards.ts";
import { createEnvGuard, validateWebEnv } from "./shared/utils/validate-env.ts";
import { logError, logInfo, logWarn } from "./shared/utils/logger.ts";
import {
  isAppError,
  RateLimitError,
} from "@takos/worker-platform-utils/errors";
import { resolveContainerHostBaseUrl } from "@takos/worker-platform-utils/container-host";
import { PRODUCTION_DOMAIN } from "./shared/constants/app.ts";
import { buildWorkersWebPlatform } from "./platform/adapters/workers.ts";
import type { ControlPlatform } from "./platform/platform-config.ts";
import { getPlatformContext, setPlatformContext } from "./platform/context.ts";
import {
  getPlatformConfig,
  getPlatformServices,
} from "./platform/accessors.ts";
import runtimeHostHandler from "./runtime/container-hosts/runtime-host.ts";
import executorHostHandler from "./runtime/container-hosts/executor-host.ts";

// Durable Object exports for wrangler.toml bindings.
export { SessionDO } from "./runtime/durable-objects/session.ts";
export { RunNotifierDO } from "./runtime/durable-objects/run-notifier.ts";
export { NotificationNotifierDO } from "./runtime/durable-objects/notification-notifier.ts";
export { RateLimiterDO } from "./runtime/durable-objects/rate-limiter.ts";
export { RoutingDO } from "./runtime/durable-objects/routing.ts";

// Cached environment validation guard.
const envGuard = createEnvGuard(validateWebEnv);

type Variables = {
  user?: User;
  platform?: ControlPlatform<Env>;
  rotated_session_id?: string;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use("*", async (c, next) => {
  const platform = getPlatformContext(c);
  if (platform) setPlatformContext(c, platform);
  await next();
});

export const webApp = app;

export function getWebApp() {
  return webApp;
}

/**
 * Alias for callers that want the singleton worker app factory shape.
 */
export const createWebApp = getWebApp;

function containerHostBaseUrl(env: Env): string {
  return resolveContainerHostBaseUrl({
    proxyBaseUrl: env.PROXY_BASE_URL,
    authPublicBaseUrl: env.AUTH_PUBLIC_BASE_URL,
    adminDomain: env.ADMIN_DOMAIN,
  });
}

function withUnifiedContainerHostEnv(env: Env): Env {
  return {
    ...env,
    TAKOS_WORKER: env.TAKOS_EGRESS,
    PROXY_BASE_URL: env.PROXY_BASE_URL ?? containerHostBaseUrl(env),
    TAKOS_AGENT_CONTROL_RPC_BASE_URL:
      env.TAKOS_AGENT_CONTROL_RPC_BASE_URL ?? containerHostBaseUrl(env),
  } as Env;
}

function isFeaturedAppCatalogSaveValidationError(error: unknown): boolean {
  if (isFeaturedAppCatalogInvalidError(error)) return true;
  if (!(error instanceof Error)) return false;
  return [
    "featured app catalog ",
    "featured app group name is invalid:",
    "featured app repository URL must ",
    "duplicate featured app group name:",
    "duplicate featured app repository URL:",
  ].some((prefix) => error.message.startsWith(prefix));
}

// CORS - explicit configuration for security
// Configured with:
// - Allowed origins: Admin domain (env.ADMIN_DOMAIN) and localhost for development
// - Allowed methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
// - Allowed headers: Content-Type, Authorization, X-Requested-With, Accept
// - Expose headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
// - Max age: 86400 (24 hours) for preflight caching
// - Credentials: true (for cookie-based auth)
app.use("*", async (c, next) => {
  const corsMiddleware = cors({
    origin: (origin) => {
      if (!origin) return null;
      const config = getPlatformConfig(c);
      return isAllowedOrigin(origin, config.adminDomain, config.environment)
        ? origin
        : null;
    },
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
    ],
    exposeHeaders: [
      "X-RateLimit-Limit",
      "X-RateLimit-Remaining",
      "X-RateLimit-Reset",
    ],
    maxAge: 86400, // 24 hours
  });
  return corsMiddleware(c, next);
});

// HTTPS enforcement (pre-next gate) + S28 security headers (post-next).
// Single middleware: the relative order of the HTTPS gate (before next) and the
// header mutation (after next) matches the previous two adjacent `app.use("*")`
// blocks, so a rejected (non-HTTPS) request still short-circuits without
// receiving security headers, exactly as before.
app.use("*", async (c, next): Promise<Response | void> => {
  // HTTPS enforcement middleware for production edge/proxy runtimes.
  // Check X-Forwarded-Proto header for HTTPS.
  const proto = c.req.header("X-Forwarded-Proto");

  // Use operator-controlled env var instead of client-controlled Host header
  // to determine whether HTTPS enforcement should be skipped.
  const isDev = getPlatformConfig(c).environment === "development";

  if (!isDev) {
    // Require HTTPS in production - reject if X-Forwarded-Proto exists and is not https
    if (proto && proto !== "https") {
      return c.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "HTTPS required",
          },
        },
        403,
      );
    }
  }

  await next();

  // S28: Security headers (CSP, X-Frame-Options, etc.)
  // Add security headers to all responses
  const response = c.res;
  const headers = response.headers;

  // S28: Content Security Policy - restrict script/style/image sources
  const adminDomain = getPlatformConfig(c).adminDomain || PRODUCTION_DOMAIN;
  const csp = [
    "default-src 'self'",
    "script-src 'self' https://static.cloudflareinsights.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https: blob:",
    "connect-src 'self' https://api.openai.com",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    `form-action 'self' https://${adminDomain}`,
    "object-src 'none'",
  ].join("; ");

  // Only add CSP to HTML responses (not API JSON responses)
  // Skip if route already set a custom CSP (e.g., with nonce for inline scripts)
  const contentType = headers.get("Content-Type") || "";
  if (
    contentType.includes("text/html") &&
    !headers.has("Content-Security-Policy")
  ) {
    headers.set("Content-Security-Policy", csp);
  }

  // S28: Additional security headers for all responses
  headers.set("X-Content-Type-Options", "nosniff");
  // The admin console is never meant to be embedded — DENY > SAMEORIGIN.
  headers.set("X-Frame-Options", "DENY");
  // X-XSS-Protection is intentionally omitted per OWASP guidance.
  if (!headers.has("Referrer-Policy")) {
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  }
  headers.set(
    "Permissions-Policy",
    [
      "camera=()",
      "microphone=()",
      "geolocation=()",
      "payment=()",
      "usb=()",
      "bluetooth=()",
      "magnetometer=()",
      "gyroscope=()",
      "accelerometer=()",
      "xr-spatial-tracking=()",
      "display-capture=()",
      "browsing-topics=()",
      "interest-cohort=()",
    ].join(", "),
  );
  // Cross-origin isolation. COOP=same-origin protects against malicious
  // window.opener references from OAuth popups; CORP=same-site limits
  // cross-origin embedding of admin-served resources. Static public brand
  // assets may set a narrower cross-origin exception before this middleware
  // resumes.
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  if (!headers.has("Cross-Origin-Resource-Policy")) {
    headers.set("Cross-Origin-Resource-Policy", "same-site");
  }

  // HSTS: only set in production (env-controlled). Operators on edges
  // without TLS termination (local dev) shouldn't get this header.
  // 1 year max-age + includeSubDomains + preload is the OWASP-recommended
  // baseline for credential-bearing admin consoles.
  if (c.env.ENVIRONMENT !== "development") {
    headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains; preload",
    );
  }
});

// Static assets middleware (for admin domain only)
// With serve_directly = false, we need to explicitly serve static assets
app.use("*", staticAssetsMiddleware);

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

app.get(TAKOSUMI_WELL_KNOWN_PATH, (c) =>
  c.json(createTakosDistributionWellKnown(new URL(c.req.url).origin)),
);

// Git Smart HTTP (read-only clone/fetch) served from the R2-backed object store.
// Mounted at the top level so `git clone https://<host>/git/<owner>/<repo>.git`
// works; push is refused inside the router.
app.route("/", gitSmartHttp);

app.get(TAKOSUMI_PRODUCT_CAPABILITIES_PATH, (c) =>
  c.json(createTakosDistributionProductCapabilities(new URL(c.req.url).origin)),
);

app.get("/.well-known/takos", (c) =>
  c.json(createTakosProductWellKnown(new URL(c.req.url).origin), 200, {
    "Cache-Control": "public, max-age=300",
  }),
);

// ============================================================================
// Unified container-host callbacks
// ============================================================================
// Cloudflare Containers live as Durable Object classes exported by this same
// Worker. External callbacks from those containers still need stable HTTP paths,
// so the main worker routes them into the in-process host handlers.

app.all("/forward/*", async (c) => {
  return runtimeHostHandler.fetch(
    c.req.raw,
    withUnifiedContainerHostEnv(c.env) as never,
  );
});

app.all("/api/internal/v1/agent-control/*", async (c) => {
  return executorHostHandler.fetch(
    c.req.raw,
    withUnifiedContainerHostEnv(c.env) as never,
  );
});

// ============================================================================
// Public Routes (no auth required)
// ============================================================================

// Auth routes (public) — rate-limited login/callback/cli
{
  const authRateLimiter = RateLimiters.auth();
  const auth = new Hono<{ Bindings: Env; Variables: Variables }>();
  auth.use("/oidc/login", authRateLimiter.middleware());
  auth.use("/oidc/callback", authRateLimiter.middleware());
  auth.route("/", authSessionRouter);
  auth.route("/", authOidcRouter);
  app.route("/auth", auth);
}

// ============================================================================
// Internal Scheduled Trigger (for k8s CronJob / EventBridge / Cloud Scheduler)
// ============================================================================
// Allows external cron systems to trigger the same maintenance jobs that
// CF Workers cron triggers run.  Access is restricted to loopback or
// authenticated cluster-internal hostnames.

app.post("/internal/scheduled", async (c) => {
  const access = validateInternalApiAccess(c.req.url, c.env, (name) =>
    c.req.header(name),
  );
  if (!access.ok) {
    return c.json(
      {
        error: {
          code: "FORBIDDEN",
          message: access.message,
        },
      },
      access.status,
    );
  }

  const cron = c.req.query("cron") ?? "*/15 * * * *";
  const env = c.env;
  const errors: Array<{ job: string; error: string }> = [];
  let appScheduleSummary: Awaited<
    ReturnType<typeof dispatchScheduledComputeTriggers>
  > | null = null;
  let workflowScheduleSummary: Awaited<
    ReturnType<typeof triggerScheduledWorkflows>
  > | null = null;

  try {
    await runScheduledFamilyMaintenance(env, cron, errors);
    await runCommonEnvScheduledMaintenance({ env, cron, errors });
    const platform = getPlatformContext(c);
    if (platform) {
      appScheduleSummary = await dispatchScheduledComputeTriggers({
        env,
        platform,
        cron,
        errors,
      });
    } else {
      errors.push({
        job: "app-schedules",
        error: "PLATFORM context is unavailable",
      });
    }
    workflowScheduleSummary = await triggerScheduledWorkflows(
      {
        db: env.DB,
        bucket: env.GIT_OBJECTS,
        queue: env.WORKFLOW_QUEUE,
        encryptionKey: env.ENCRYPTION_KEY,
      },
      {
        windowMinutes: scheduledWorkflowWindowMinutes(cron),
      },
    );
  } catch (error) {
    errors.push({
      job: "scheduled-http",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (errors.length > 0) {
    return c.json({ status: "error", cron, errors }, 500);
  }
  return c.json({
    status: "ok",
    cron,
    appSchedules: appScheduleSummary,
    workflowSchedules: workflowScheduleSummary,
  });
});

app.put("/internal/featured-app-catalog", async (c) => {
  const env = c.env;
  const access = validateInternalApiAccess(c.req.url, env, (name) =>
    c.req.header(name),
  );
  if (!access.ok) {
    return c.json(
      {
        error: {
          code: "FORBIDDEN",
          message: access.message,
        },
      },
      access.status,
    );
  }

  if (hasFeaturedAppCatalogEnvOverride(env)) {
    return c.json(
      {
        error: {
          code: "CONFLICT",
          message:
            "TAKOS_FEATURED_APP_CATALOG_JSON or TAKOS_FEATURED_APP_REPOSITORIES_JSON is configured; env overrides DB-operator-provided coverage app catalog. Remove the env override before saving DB catalog.",
        },
      },
      409,
    );
  }

  const body = (await c.req.json().catch(() => null)) as
    { entries?: unknown; repositories?: unknown } | unknown[];
  const entries = Array.isArray(body)
    ? body
    : Array.isArray(body?.entries)
      ? body.entries
      : Array.isArray(body?.repositories)
        ? body.repositories
        : null;
  if (!entries) {
    return c.json(
      {
        error: {
          code: "BAD_REQUEST",
          message:
            "Expected a JSON array, or an object with entries/repositories array",
        },
      },
      400,
    );
  }

  let saved;
  try {
    saved = await saveFeaturedAppCatalogEntries(env, entries);
  } catch (error) {
    if (isFeaturedAppCatalogSaveValidationError(error)) {
      return c.json(
        {
          error: {
            code: "BAD_REQUEST",
            message: error instanceof Error ? error.message : String(error),
          },
        },
        400,
      );
    }
    throw error;
  }
  return c.json({ entries: saved });
});

app.delete("/internal/featured-app-catalog", async (c) => {
  const env = c.env;
  const access = validateInternalApiAccess(c.req.url, env, (name) =>
    c.req.header(name),
  );
  if (!access.ok) {
    return c.json(
      {
        error: {
          code: "FORBIDDEN",
          message: access.message,
        },
      },
      access.status,
    );
  }

  if (hasFeaturedAppCatalogEnvOverride(env)) {
    return c.json(
      {
        error: {
          code: "CONFLICT",
          message:
            "TAKOS_FEATURED_APP_CATALOG_JSON or TAKOS_FEATURED_APP_REPOSITORIES_JSON is configured; env overrides DB-operator-provided coverage app catalog. Remove the env override before clearing DB catalog.",
        },
      },
      409,
    );
  }

  await clearFeaturedAppCatalogEntries(env);
  return c.json({ status: "ok" });
});

app.get("/api/internal/v1/featured-apps/status", async (c) => {
  const env = c.env;
  const access = validateInternalApiAccess(c.req.url, env, (name) =>
    c.req.header(name),
  );
  if (!access.ok) {
    return c.json(
      {
        error: {
          code: "FORBIDDEN",
          message: access.message,
        },
      },
      access.status,
    );
  }

  try {
    return c.json(await getFeaturedAppReconcileStatus(env));
  } catch (error) {
    if (isFeaturedAppCatalogInvalidError(error)) {
      return c.json({
        catalog: {
          source: "invalid",
          preinstallEnabled: null,
          entries: [],
          totalEntries: 0,
          preinstallEntries: 0,
          error: error instanceof Error ? error.message : String(error),
        },
        jobs: {
          available: false,
          total: 0,
          byStatus: {},
          latestUpdatedAt: null,
          lastErrors: [],
        },
      });
    }
    throw error;
  }
});

// ============================================================================
// API Routes (under /api prefix)
// ============================================================================

const apiRouter = createApiRouter({ requireAuth, optionalAuth });

// Mount API router at /api
app.route("/api", apiRouter);

// ============================================================================
// Error Handling
// ============================================================================

// 404 handler - serve SPA for non-API routes, JSON error for API routes
app.notFound(async (c) => {
  const path = new URL(c.req.url).pathname;

  // If it's an API/auth/reserved route, return a JSON error instead of the SPA
  // shell. `/git/` (worker-native Git Smart HTTP, read-only clone/fetch) is
  // handled by the gitSmartHttp router above; it is listed here so that any
  // request that does fall through is answered as a machine-readable 404
  // rather than HTML.
  if (
    path.startsWith("/api/") ||
    path.startsWith("/auth/") ||
    path === "/oauth" ||
    path.startsWith("/oauth/") ||
    path.startsWith("/git/") ||
    path.startsWith("/.well-known/") ||
    path.startsWith("/v1/") ||
    path.startsWith("/__takosumi/")
  ) {
    return c.json(
      {
        error: {
          code: "NOT_FOUND",
          message: "Not Found",
        },
      },
      404,
    );
  }

  // For non-API routes, serve index.html (SPA fallback)
  const assets = getPlatformServices(c).assets.binding;
  if (assets) {
    try {
      const indexHtml = await assets.fetch(
        new Request(new URL("/index.html", c.req.url)),
      );
      if (indexHtml.ok) {
        return new Response(indexHtml.body, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-cache",
          },
        });
      }
    } catch (e) {
      logError("Failed to serve SPA fallback", e, { module: "web" });
    }
  }

  return c.json(
    {
      error: {
        code: "NOT_FOUND",
        message: "Not Found",
      },
    },
    404,
  );
});

// S14: Error handler - never expose stack traces or sensitive error details in production
app.onError((err, c) => {
  if (isInvalidArrayBufferError(err)) {
    logWarn(
      `Rejected malformed lookup payload on ${c.req.method} ${c.req.path}`,
      { module: "db_guard" },
    );
    return c.json(
      {
        error: {
          code: "BAD_REQUEST",
          message: "Malformed lookup parameter",
        },
      },
      400,
    );
  }

  // Handle AppError subclasses — return structured error responses
  if (isAppError(err)) {
    // Only log server errors (5xx) at error level; client errors are expected
    if (err.statusCode >= 500) {
      logError("AppError (server)", err, { module: "web" });
    }

    const body = err.toResponse();

    // Set Retry-After header and body details for rate limit errors.
    if (err instanceof RateLimitError) {
      c.header("Retry-After", String(err.retryAfter));
      const existingDetails = body.error.details;
      body.error.details = {
        ...(existingDetails && typeof existingDetails === "object"
          ? (existingDetails as Record<string, unknown>)
          : {}),
        retryAfter: err.retryAfter,
      };
    }

    const response = c.json(
      body,
      err.statusCode as import("hono/utils/http-status").ContentfulStatusCode,
    );

    return response;
  }

  // Log full error for debugging (server-side only)
  logError("Unhandled error", err, { module: "web" });

  // Generate a unique error ID for correlation
  const errorId = crypto.randomUUID().slice(0, 8);

  // In production, only return generic error with correlation ID
  return c.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred. Please try again later.",
        details: {
          error_id: errorId,
        },
      },
    },
    500,
  );
});

// ============================================================================
// Export
// ============================================================================

export function createWebWorker(
  buildPlatform: (
    env: Env,
  ) =>
    | ControlPlatform<Env>
    | Promise<ControlPlatform<Env>> = buildWorkersWebPlatform,
) {
  return {
    async fetch(
      request: Request,
      env: Env,
      ctx: PlatformExecutionContext,
    ): Promise<Response> {
      const platform = await buildPlatform(env);
      const bindings = platform.bindings;
      const requestBindings = {
        ...bindings,
        PLATFORM: platform,
      } as Env & {
        PLATFORM?: ControlPlatform<Env>;
      };

      // Validate environment on first request (cached for subsequent requests)
      const envValidationError = envGuard(bindings);

      // Return error for critical config issues (except health check)
      const url = new URL(request.url);
      if (envValidationError && url.pathname !== "/health") {
        return new Response(
          JSON.stringify({
            error: {
              code: "SERVICE_UNAVAILABLE",
              message: "Server is misconfigured. Please contact administrator.",
            },
          }),
          {
            status: 503,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      // Defensive host gate: this worker is intended for the admin domain only,
      // plus service-binding internal calls.
      const hostname = url.hostname;
      if (
        hostname !== platform.config.adminDomain &&
        hostname !== "internal" &&
        !hostname.endsWith(".workers.dev") &&
        !isSelfHostLoopback(hostname) &&
        !isSelfHostInternalHostname(hostname)
      ) {
        return new Response("Not Found", { status: 404 });
      }

      return app.fetch(request, requestBindings, ctx);
    },

    // Scheduled jobs (cron)
    async scheduled(
      controller: PlatformScheduledController,
      env: Env,
    ): Promise<void> {
      const platform = await buildPlatform(env);
      const bindings = platform.bindings;
      const cron = controller.cron;
      const errors: Array<{ job: string; error: string }> = [];

      await runScheduledFamilyMaintenance(bindings, cron, errors, {
        logSuccesses: true,
      });

      await runCommonEnvScheduledMaintenance({ env: bindings, cron, errors });

      try {
        const summary = await dispatchScheduledComputeTriggers({
          env: bindings,
          platform,
          cron,
          errors,
        });
        if (summary.targetsDispatched > 0) {
          logInfo("app schedule dispatch completed", {
            module: "cron",
            cron,
            ...summary,
          });
        }
      } catch (error) {
        errors.push({
          job: "app-schedules",
          error: error instanceof Error ? error.message : String(error),
        });
      }

      try {
        const summary = await triggerScheduledWorkflows(
          {
            db: bindings.DB,
            bucket: bindings.GIT_OBJECTS,
            queue: bindings.WORKFLOW_QUEUE,
            encryptionKey: bindings.ENCRYPTION_KEY,
          },
          {
            windowMinutes: scheduledWorkflowWindowMinutes(cron),
          },
        );
        if (summary.triggeredRunIds.length > 0) {
          logInfo("workflow schedule dispatch completed", {
            module: "cron",
            cron,
            reposScanned: String(summary.reposScanned),
            workflowsScanned: String(summary.workflowsScanned),
            schedulesMatched: String(summary.schedulesMatched),
            triggered: String(summary.triggeredRunIds.length),
            skippedDuplicates: String(summary.skippedDuplicates),
            invalidCrons: String(summary.invalidCrons),
          });
        }
      } catch (error) {
        errors.push({
          job: "workflow-schedules",
          error: error instanceof Error ? error.message : String(error),
        });
      }

      if (errors.length > 0) {
        logError(
          "scheduled job failures",
          { cron, errors },
          {
            module: "cron",
          },
        );
        // Ensure failures are visible in cron monitoring, without impacting request traffic.
        const summary = errors.map((e) => `${e.job}: ${e.error}`).join("; ");
        throw new Error(
          `scheduled job failures (cron=${cron}, count=${errors.length}): ${summary}`,
        );
      }
    },
  };
}

export const webWorker = createWebWorker();

export default webWorker;
