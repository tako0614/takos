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
import { externalAuthRouter } from "./server/routes/auth/external.ts";
import { authSessionRouter } from "./server/routes/auth/session.ts";
import { authCliRouter } from "./server/routes/auth/cli.ts";
import { authLinkRouter } from "./server/routes/auth/link.ts";
import oauth from "./server/routes/oauth/routes.ts";
import wellKnown from "./server/routes/well-known.ts";
import { registerProfileRoutes } from "./server/routes/profiles/register.ts";
import { smartHttpRoutes } from "./server/routes/smart-http.ts";
import {
  cleanupDeadSessions,
  reconcileStuckDomains,
  runCustomDomainReverification,
  runSnapshotGcBatch,
} from "./application/services/maintenance/index.ts";
import { runR2OrphanedObjectGcBatch } from "./application/services/r2/orphaned-object-gc.ts";
import { runCommonEnvScheduledMaintenance } from "./application/services/common-env/index.ts";
import { runWorkflowArtifactGcBatch } from "./application/services/execution/workflow-storage.ts";
import { dispatchScheduledComputeTriggers } from "./application/services/deployment/scheduled-triggers.ts";
import { triggerScheduledWorkflows } from "./application/services/actions/actions-triggers.ts";
import {
  clearDefaultAppDistributionEntries,
  hasDefaultAppDistributionEnvOverride,
  isDefaultAppDistributionInvalidError,
  processDefaultAppPreinstallJobs,
  saveDefaultAppDistributionEntries,
} from "./application/services/source/default-app-distribution.ts";
import { optionalAuth, requireAuth } from "./server/middleware/auth.ts";
import { staticAssetsMiddleware } from "./server/middleware/static-assets.ts";
import { isInvalidArrayBufferError } from "./shared/utils/db-guards.ts";
import { createEnvGuard, validateWebEnv } from "./shared/utils/validate-env.ts";
import { logError, logInfo, logWarn } from "./shared/utils/logger.ts";
import { constantTimeEqual } from "./shared/utils/hash.ts";
import { isAppError, RateLimitError } from "takos-common/errors";
import { PRODUCTION_DOMAIN } from "./shared/constants/app.ts";
import { buildWorkersWebPlatform } from "./platform/adapters/workers.ts";
import type { ControlPlatform } from "./platform/platform-config.ts";
import { setPlatformContext } from "./platform/context.ts";
import {
  getPlatformConfig,
  getPlatformServices,
} from "./platform/accessors.ts";
import { createExecutorProxyRouter } from "./runtime/executor-proxy-api.ts";

// Durable Object exports for wrangler.toml bindings.
export { SessionDO } from "./runtime/durable-objects/session.ts";
export { RunNotifierDO } from "./runtime/durable-objects/run-notifier.ts";
export { NotificationNotifierDO } from "./runtime/durable-objects/notification-notifier.ts";
export { RateLimiterDO } from "./runtime/durable-objects/rate-limiter.ts";
export { RoutingDO } from "./runtime/durable-objects/routing.ts";
export { GitPushLockDO } from "./runtime/durable-objects/git-push-lock.ts";

// Cached environment validation guard.
const envGuard = createEnvGuard(validateWebEnv);

type Variables = {
  user?: User;
  platform?: ControlPlatform<Env>;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use("*", async (c, next) => {
  const platformEnv = c.env as Env & { PLATFORM?: ControlPlatform<Env> };
  if (platformEnv.PLATFORM) {
    setPlatformContext(c, platformEnv.PLATFORM);
  }
  await next();
});

export const webApp = app;

export function getWebApp() {
  return webApp;
}

/**
 * Backward-compatible alias for older callers.
 * Prefer `getWebApp()` when you want the singleton worker app.
 */
export const createWebApp = getWebApp;

function isAllowedOrigin(origin: string, adminDomain: string): boolean {
  if (origin === `https://${adminDomain}`) return true;
  if (
    origin.startsWith("http://localhost:") ||
    origin.startsWith("http://127.0.0.1:")
  ) {
    return true;
  }
  return false;
}

function isSelfHostLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" ||
    hostname === "::1" || hostname === "[::1]";
}

function isSelfHostInternalHostname(hostname: string): boolean {
  return hostname === "control-web";
}

function validateInternalApiAccess(
  url: string,
  env: Env,
  getHeader: (name: string) => string | undefined,
): { ok: true } | { ok: false; status: 403; message: string } {
  const hostname = new URL(url).hostname;
  if (isSelfHostLoopback(hostname)) {
    return { ok: true };
  }
  if (!isSelfHostInternalHostname(hostname)) {
    return { ok: false, status: 403, message: "forbidden" };
  }

  const expectedSecret = env.TAKOS_INTERNAL_API_SECRET;
  if (!expectedSecret) {
    return {
      ok: false,
      status: 403,
      message: "internal API secret is not configured",
    };
  }

  const actualSecret = getHeader("X-Takos-Internal-Secret");
  if (!actualSecret || !constantTimeEqual(actualSecret, expectedSecret)) {
    return { ok: false, status: 403, message: "forbidden" };
  }

  return { ok: true };
}

function isDefaultAppDistributionSaveValidationError(error: unknown): boolean {
  if (isDefaultAppDistributionInvalidError(error)) return true;
  if (!(error instanceof Error)) return false;
  return [
    "default app distribution ",
    "default app group name is invalid:",
    "default app repository URL must ",
    "duplicate default app group name:",
    "duplicate default app repository URL:",
  ].some((prefix) => error.message.startsWith(prefix));
}

// Cron schedule classifiers.
//
// Production wrangler.toml uses offset cron strings (e.g. `3,18,33,48 * * * *`,
// `5 * * * *`) to spread cron load and avoid Cloudflare cron-storm windows.
// Local / dev callers use the canonical `*/15 * * * *` and `0 * * * *` forms.
// Both must dispatch to the same maintenance jobs, so the dispatcher matches
// on schedule *family* rather than literal equality.
const QUARTER_HOUR_CRONS = new Set([
  "*/15 * * * *",
  "3,18,33,48 * * * *",
]);

const HOURLY_CRONS = new Set([
  "0 * * * *",
  "5 * * * *",
]);

function isQuarterHourCron(cron: string): boolean {
  return QUARTER_HOUR_CRONS.has(cron);
}

function isHourlyCron(cron: string): boolean {
  return HOURLY_CRONS.has(cron);
}

function scheduledWorkflowWindowMinutes(cron: string): number {
  if (isHourlyCron(cron)) return 60;
  if (isQuarterHourCron(cron)) return 15;
  return 1;
}

type ScheduledJobError = { job: string; error: string };

type ScheduledFamilyMaintenanceDeps = {
  cleanupDeadSessions: typeof cleanupDeadSessions;
  reconcileStuckDomains: typeof reconcileStuckDomains;
  runCustomDomainReverification: typeof runCustomDomainReverification;
  runR2OrphanedObjectGcBatch: typeof runR2OrphanedObjectGcBatch;
  runSnapshotGcBatch: typeof runSnapshotGcBatch;
  runWorkflowArtifactGcBatch: typeof runWorkflowArtifactGcBatch;
  processDefaultAppPreinstallJobs: typeof processDefaultAppPreinstallJobs;
  logInfo: typeof logInfo;
};

const defaultScheduledFamilyMaintenanceDeps: ScheduledFamilyMaintenanceDeps = {
  cleanupDeadSessions,
  reconcileStuckDomains,
  runCustomDomainReverification,
  runR2OrphanedObjectGcBatch,
  runSnapshotGcBatch,
  runWorkflowArtifactGcBatch,
  processDefaultAppPreinstallJobs,
  logInfo,
};

function toScheduledError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runScheduledFamilyMaintenance(
  env: Env,
  cron: string,
  errors: ScheduledJobError[],
  options: { logSuccesses?: boolean } = {},
  deps: ScheduledFamilyMaintenanceDeps = defaultScheduledFamilyMaintenanceDeps,
): Promise<void> {
  const { logSuccesses = false } = options;
  const runQuarterHourJobs = isQuarterHourCron(cron) || cron === "* * * * *";
  const runHourlyJobs = isHourlyCron(cron) || cron === "* * * * *";

  if (runQuarterHourJobs) {
    try {
      const summary = await deps.runCustomDomainReverification(env, {
        batchSize: 200,
      });
      const reconSummary = await deps.reconcileStuckDomains(env);

      if (logSuccesses) {
        deps.logInfo("custom-domain reverification completed", {
          module: "cron",
          ...{
            cron,
            ...summary,
          },
        });
        deps.logInfo("stuck-domain reconciliation completed", {
          module: "cron",
          ...{
            cron,
            ...reconSummary,
          },
        });
      }
    } catch (error) {
      errors.push({
        job: "custom-domains",
        error: toScheduledError(error),
      });
    }

    try {
      const summary = await deps.processDefaultAppPreinstallJobs(env, {
        limit: 10,
      });

      if (logSuccesses && summary.processed > 0) {
        deps.logInfo("default app preinstall jobs processed", {
          module: "cron",
          cron,
          ...summary,
        });
      }
    } catch (error) {
      errors.push({
        job: "default-app-preinstall",
        error: toScheduledError(error),
      });
    }
  }

  if (runHourlyJobs) {
    try {
      const sessionSummary = await deps.cleanupDeadSessions(env);

      if (logSuccesses) {
        deps.logInfo("dead session cleanup completed", {
          module: "cron",
          ...{
            cron,
            marked_dead: sessionSummary.markedDead,
            cutoff_time: sessionSummary.cutoffTime,
            startup_cutoff: sessionSummary.startupCutoff,
          },
        });
      }
    } catch (error) {
      errors.push({
        job: "sessions.cleanup-dead",
        error: toScheduledError(error),
      });
    }

    try {
      const gcSummary = await deps.runSnapshotGcBatch(env, {
        maxSpaces: 5,
      });

      if (logSuccesses) {
        deps.logInfo("snapshot GC batch completed", {
          module: "cron",
          ...{
            cron,
            ...gcSummary,
          },
        });
      }
    } catch (error) {
      errors.push({
        job: "snapshot-gc",
        error: toScheduledError(error),
      });
    }

    try {
      const orphanSummary = await deps.runR2OrphanedObjectGcBatch(env, {
        dryRun: false,
        minAgeMinutes: 24 * 60,
        listLimit: 200,
        maxDeletes: 200,
      });

      if (logSuccesses && !orphanSummary.skipped) {
        deps.logInfo("r2 orphaned object GC batch completed", {
          module: "cron",
          ...{ cron, ...orphanSummary },
        });
      }
    } catch (error) {
      errors.push({
        job: "r2-orphaned-object-gc",
        error: toScheduledError(error),
      });
    }

    try {
      const wfGcSummary = await deps.runWorkflowArtifactGcBatch(
        env.DB,
        env.GIT_OBJECTS,
        { maxDeletes: 100 },
      );

      if (logSuccesses && wfGcSummary.deletedRows > 0) {
        deps.logInfo("workflow artifact GC batch completed", {
          module: "cron",
          ...{ cron, ...wfGcSummary },
        });
      }
    } catch (error) {
      errors.push({
        job: "workflow-artifact-gc",
        error: toScheduledError(error),
      });
    }
  }
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
  // Skip CORS for git Smart HTTP endpoints (git clients don't send Origin)
  if (new URL(c.req.url).pathname.startsWith("/git/")) {
    await next();
    return;
  }
  const corsMiddleware = cors({
    origin: (origin) => {
      if (!origin) return null;
      return isAllowedOrigin(origin, getPlatformConfig(c).adminDomain)
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

// HTTPS enforcement middleware for production (Cloudflare Workers)
// Check X-Forwarded-Proto header for HTTPS
app.use("*", async (c, next): Promise<Response | void> => {
  const proto = c.req.header("X-Forwarded-Proto");

  // Use operator-controlled env var instead of client-controlled Host header
  // to determine whether HTTPS enforcement should be skipped.
  const isDev = getPlatformConfig(c).environment === "development";

  if (!isDev) {
    // Require HTTPS in production - reject if X-Forwarded-Proto exists and is not https
    if (proto && proto !== "https") {
      return c.json({
        error: {
          code: "FORBIDDEN",
          message: "HTTPS required",
        },
      }, 403);
    }
  }

  await next();
});

// S28: Security headers middleware (CSP, X-Frame-Options, etc.)
app.use("*", async (c, next) => {
  await next();

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
    "connect-src 'self' https://accounts.google.com https://api.openai.com",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    `form-action 'self' https://${adminDomain}`,
    "object-src 'none'",
  ].join("; ");

  // Only add CSP to HTML responses (not API JSON responses)
  // Skip if route already set a custom CSP (e.g., with nonce for inline scripts)
  const contentType = headers.get("Content-Type") || "";
  if (
    contentType.includes("text/html") && !headers.has("Content-Security-Policy")
  ) {
    headers.set("Content-Security-Policy", csp);
  }

  // S28: Additional security headers for all responses
  headers.set("X-Content-Type-Options", "nosniff");
  // The admin console is never meant to be embedded — DENY > SAMEORIGIN.
  headers.set("X-Frame-Options", "DENY");
  // X-XSS-Protection is deprecated; modern browsers ignore it. Removed per
  // OWASP guidance (the legacy XSS auditor itself introduced bugs).
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
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
  // cross-origin embedding of admin-served resources.
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Resource-Policy", "same-site");

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

// ============================================================================
// Public Routes (no auth required)
// ============================================================================

// Auth routes (public) — rate-limited login/callback/cli
{
  const authRateLimiter = RateLimiters.auth();
  const auth = new Hono<{ Bindings: Env; Variables: Variables }>();
  auth.use("/login", authRateLimiter.middleware());
  auth.use("/callback", authRateLimiter.middleware());
  auth.use("/cli", authRateLimiter.middleware());
  auth.route("/", externalAuthRouter);
  auth.route("/", authSessionRouter);
  auth.route("/", authCliRouter);
  auth.route("/", authLinkRouter);
  app.route("/auth", auth);
}

// OAuth2 Authorization Server routes (public)
app.route("/oauth", oauth);

// Well-known endpoints (public)
app.route("/.well-known", wellKnown);

// ============================================================================
// Internal Executor RPC Proxy (service-binding only, no public access)
// ============================================================================

app.route("/internal/executor-rpc", createExecutorProxyRouter());

// ============================================================================
// Internal Scheduled Trigger (for k8s CronJob / EventBridge / Cloud Scheduler)
// ============================================================================
// Allows external cron systems to trigger the same maintenance jobs that
// CF Workers cron triggers run.  Access is restricted to loopback or
// authenticated cluster-internal hostnames.

app.post("/internal/scheduled", async (c) => {
  const access = validateInternalApiAccess(
    c.req.url,
    c.env as Env,
    (name) => c.req.header(name),
  );
  if (!access.ok) {
    return c.json({
      error: {
        code: "FORBIDDEN",
        message: access.message,
      },
    }, access.status);
  }

  const cron = c.req.query("cron") ?? "*/15 * * * *";
  const env = c.env as Env;
  const errors: Array<{ job: string; error: string }> = [];
  let appScheduleSummary:
    | Awaited<
      ReturnType<typeof dispatchScheduledComputeTriggers>
    >
    | null = null;
  let workflowScheduleSummary:
    | Awaited<
      ReturnType<typeof triggerScheduledWorkflows>
    >
    | null = null;

  try {
    await runScheduledFamilyMaintenance(env, cron, errors);
    await runCommonEnvScheduledMaintenance({ env, cron, errors });
    const platform = (c.env as Env & { PLATFORM?: ControlPlatform<Env> })
      .PLATFORM;
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
    workflowScheduleSummary = await triggerScheduledWorkflows({
      db: env.DB,
      bucket: env.GIT_OBJECTS,
      queue: env.WORKFLOW_QUEUE,
      encryptionKey: env.ENCRYPTION_KEY,
    }, {
      windowMinutes: scheduledWorkflowWindowMinutes(cron),
    });
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

app.put("/internal/default-app-distribution", async (c) => {
  const env = c.env as Env;
  const access = validateInternalApiAccess(
    c.req.url,
    env,
    (name) => c.req.header(name),
  );
  if (!access.ok) {
    return c.json({
      error: {
        code: "FORBIDDEN",
        message: access.message,
      },
    }, access.status);
  }

  if (hasDefaultAppDistributionEnvOverride(env)) {
    return c.json({
      error: {
        code: "CONFLICT",
        message:
          "TAKOS_DEFAULT_APP_DISTRIBUTION_JSON or TAKOS_DEFAULT_APP_REPOSITORIES_JSON is configured; env overrides DB-managed default app distribution. Remove the env override before saving DB distribution.",
      },
    }, 409);
  }

  const body = await c.req.json().catch(() => null) as
    | { entries?: unknown; repositories?: unknown }
    | unknown[];
  const entries = Array.isArray(body)
    ? body
    : Array.isArray(body?.entries)
    ? body.entries
    : Array.isArray(body?.repositories)
    ? body.repositories
    : null;
  if (!entries) {
    return c.json({
      error: {
        code: "BAD_REQUEST",
        message:
          "Expected a JSON array, or an object with entries/repositories array",
      },
    }, 400);
  }

  let saved;
  try {
    saved = await saveDefaultAppDistributionEntries(env, entries);
  } catch (error) {
    if (isDefaultAppDistributionSaveValidationError(error)) {
      return c.json({
        error: {
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : String(error),
        },
      }, 400);
    }
    throw error;
  }
  return c.json({ entries: saved });
});

app.delete("/internal/default-app-distribution", async (c) => {
  const env = c.env as Env;
  const access = validateInternalApiAccess(
    c.req.url,
    env,
    (name) => c.req.header(name),
  );
  if (!access.ok) {
    return c.json({
      error: {
        code: "FORBIDDEN",
        message: access.message,
      },
    }, access.status);
  }

  if (hasDefaultAppDistributionEnvOverride(env)) {
    return c.json({
      error: {
        code: "CONFLICT",
        message:
          "TAKOS_DEFAULT_APP_DISTRIBUTION_JSON or TAKOS_DEFAULT_APP_REPOSITORIES_JSON is configured; env overrides DB-managed default app distribution. Remove the env override before clearing DB distribution.",
      },
    }, 409);
  }

  await clearDefaultAppDistributionEntries(env);
  return c.json({ status: "ok" });
});

// ============================================================================
// API Routes (under /api prefix)
// ============================================================================

const apiRouter = createApiRouter({ requireAuth, optionalAuth });

// Mount API router at /api
app.route("/api", apiRouter);

// ============================================================================
// Git Smart HTTP Routes (under /git prefix)
// ============================================================================

app.route("/", smartHttpRoutes);

// ============================================================================
// Profile Routes (special handling for /@username)
// ============================================================================

registerProfileRoutes(app, optionalAuth);

// ============================================================================
// Error Handling
// ============================================================================

// 404 handler - serve SPA for non-API routes, JSON error for API routes
app.notFound(async (c) => {
  const path = new URL(c.req.url).pathname;

  // If it's an API/auth/git route, return JSON error.
  // /oauth/authorize and /oauth/device are served by their Hono handlers (which
  // delegate to the SPA), so any 404 fallthrough from /oauth/ is a real 404.
  if (
    path.startsWith("/api/") ||
    path.startsWith("/auth/") ||
    path.startsWith("/oauth/") ||
    path.startsWith("/git/") ||
    path.startsWith("/ap/") ||
    path.startsWith("/ns/") ||
    path.startsWith("/.well-known/")
  ) {
    return c.json({
      error: {
        code: "NOT_FOUND",
        message: "Not Found",
      },
    }, 404);
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

  return c.json({
    error: {
      code: "NOT_FOUND",
      message: "Not Found",
    },
  }, 404);
});

// S14: Error handler - never expose stack traces or sensitive error details in production
app.onError((err, c) => {
  if (isInvalidArrayBufferError(err)) {
    logWarn(
      `Rejected malformed lookup payload on ${c.req.method} ${c.req.path}`,
      { module: "db_guard" },
    );
    return c.json({
      error: {
        code: "BAD_REQUEST",
        message: "Malformed lookup parameter",
      },
    }, 400);
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
          ? existingDetails as Record<string, unknown>
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
  return c.json({
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred. Please try again later.",
      details: {
        error_id: errorId,
      },
    },
  }, 500);
});

// ============================================================================
// Export
// ============================================================================

export function createWebWorker(
  buildPlatform: (
    env: Env,
  ) => ControlPlatform<Env> | Promise<ControlPlatform<Env>> =
    buildWorkersWebPlatform,
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
        const summary = await triggerScheduledWorkflows({
          db: bindings.DB,
          bucket: bindings.GIT_OBJECTS,
          queue: bindings.WORKFLOW_QUEUE,
          encryptionKey: bindings.ENCRYPTION_KEY,
        }, {
          windowMinutes: scheduledWorkflowWindowMinutes(cron),
        });
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
        logError("scheduled job failures", { cron, errors }, {
          module: "cron",
        });
        // Ensure failures are visible in cron monitoring, without impacting request traffic.
        throw new Error("scheduled job failures");
      }
    },
  };
}

export const webWorker = createWebWorker();

export default webWorker;
