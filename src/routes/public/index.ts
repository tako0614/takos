import { deleteEnv, envObject, getEnv, setEnv } from "@takos/worker-platform-utils/runtime-env";
import { Hono } from "hono";
import type { PlatformExecutionContext } from "takos-worker/shared/types";
import type { ApiBindings } from "./shared/api/bindings.ts";
import {
  bodyLimitMiddleware,
  DEFAULT_BODY_LIMIT_BYTES,
  DEPLOY_BODY_LIMIT_BYTES,
  GIT_SMART_HTTP_BODY_LIMIT_BYTES,
} from "./shared/api/body-limit.ts";
import {
  commonError,
  REQUEST_ID_HEADER,
  resolveRequestId,
} from "./shared/api/common.ts";
import { csrfMiddleware } from "./shared/api/csrf.ts";
import {
  forwardAccountControlRequest,
  isAccountControlPath,
} from "./routes/account/index.ts";
import { registerDeploymentsPublicRoutes } from "./routes/deployments-public.ts";
import { registerExplorePublicRoutes } from "./routes/explore-public.ts";
import { registerRepositoriesPublicRoutes } from "./routes/repositories-public.ts";
import { registerRunsPublicRoutes } from "./routes/runs-public.ts";
import { registerRuntimeGatewayPublicRoutes } from "./routes/runtime-gateway-public.ts";
import { registerSpacesPublicRoutes } from "./routes/spaces-public.ts";
import { registerThreadsPublicRoutes } from "./routes/threads-public.ts";
import {
  forwardProfileControlRequest,
  isProfileControlPath,
} from "./routes/profile/index.ts";
import {
  forwardRunsControlRequest,
  isRunsControlPath,
} from "./routes/runs/index.ts";
import {
  forwardSetupControlRequest,
  isSetupControlPath,
} from "./routes/setup/index.ts";
import {
  forwardAppInstallationsControlRequest,
  isAppInstallationsControlPath,
} from "./routes/app-installations/index.ts";
import {
  forwardSpaceToolsControlRequest,
  isSpaceToolsControlPath,
} from "./routes/space-tools/index.ts";
import {
  forwardThreadsControlRequest,
  isThreadsControlPath,
} from "./routes/threads/index.ts";
import {
  isGitSmartHttpPath,
  proxyGitSmartHttpRequest,
} from "./shared/api/forwarding.ts";
import {
  isRetiredTakosBillingPath,
  isRetiredTakosOAuthProviderPath,
  isRetiredTakosPublicationsPath,
  retiredTakosBillingResponse,
  retiredTakosOAuthProviderResponse,
  retiredTakosPublicationsResponse,
} from "./shared/api/retired.ts";

const app: Hono<{ Bindings: ApiBindings }> = new Hono();

// Request-correlation stamp. Resolves one stable id per request (honoring a
// caller-supplied `x-request-id`, otherwise minting a UUID) and echoes it on
// every response, success or error. This keeps the response contract uniform:
// route helpers, the auth layer, and the global `onError` boundary all surface
// the same `x-request-id` header alongside the closed `{ error: { code,
// message } }` envelope, so a client can always correlate a failure with logs.
// Registered first so even early middleware rejections (body-limit, CSRF)
// carry the header.
app.use("*", async (c, next) => {
  const requestId = resolveRequestId(c.req);
  await next();
  if (c.res.headers.has(REQUEST_ID_HEADER)) return;
  try {
    c.res.headers.set(REQUEST_ID_HEADER, requestId);
  } catch {
    // Some runtimes expose immutable headers on responses cloned from an
    // upstream `fetch` (proxied routes). Re-wrap so the correlation header is
    // still present without mutating the original response.
    c.res = new Response(c.res.body, {
      status: c.res.status,
      statusText: c.res.statusText,
      headers: new Headers(c.res.headers),
    });
    c.res.headers.set(REQUEST_ID_HEADER, requestId);
  }
});

const HEALTH_PROBE_TIMEOUT_MS = 800;
const STANDALONE_STARTUP_RETRY_ATTEMPTS = 30;
const STANDALONE_STARTUP_RETRY_DELAY_MS = 1_000;
const STANDALONE_ENV_KEYS = [
  "ADMIN_DOMAIN",
  "OIDC_DISCOVERY_URL",
  "OIDC_ISSUER_URL",
  "TAKOS_INTERNAL_API_SECRET",
  "TAKOS_DEFAULT_APP_DISTRIBUTION_JSON",
  "TAKOS_DEFAULT_APP_REPOSITORIES_JSON",
  "TAKOS_DEFAULT_APP_PREINSTALL_ENABLED",
  "TAKOSUMI_ACCOUNTS_INTERNAL_URL",
  "TAKOSUMI_ACCOUNTS_TOKEN",
  "TAKOSUMI_ACCOUNTS_URL",
] as const;

type HealthCheckResult =
  | { ok: true; latencyMs: number }
  | { ok: false; reason: string; latencyMs: number };

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race<T>([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`probe timeout after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function probeDb(
  db: ApiBindings["DB"] | undefined,
): Promise<HealthCheckResult> {
  const start = Date.now();
  if (!db) {
    return { ok: false, reason: "DB binding missing", latencyMs: 0 };
  }
  try {
    await withTimeout(
      Promise.resolve(db.prepare("select 1 as ok").first()),
      HEALTH_PROBE_TIMEOUT_MS,
    );
    return { ok: true, latencyMs: Date.now() - start };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - start,
    };
  }
}

async function probeUpstream(
  url: string | undefined,
  label: string,
  path = "/health",
): Promise<HealthCheckResult | { skipped: true }> {
  if (!url) return { skipped: true };
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    HEALTH_PROBE_TIMEOUT_MS,
  );
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}${path}`, {
      method: "GET",
      signal: controller.signal,
    });
    const latencyMs = Date.now() - start;
    if (!response.ok) {
      return {
        ok: false,
        reason: `${label} returned status ${response.status}`,
        latencyMs,
      };
    }
    return { ok: true, latencyMs };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - start,
    };
  } finally {
    clearTimeout(timer);
  }
}

app.get("/health", async (c) => {
  const env = c.env as ApiBindings;
  const accountsUrl = env.TAKOSUMI_ACCOUNTS_INTERNAL_URL ??
    env.TAKOSUMI_ACCOUNTS_URL;

  // Run probes in parallel so the overall response stays well under one
  // second even when an upstream is slow to respond.
  const [dbResult, accountsResult] = await Promise.all([
    probeDb(env.DB),
    probeUpstream(accountsUrl, "takosumi-accounts", "/healthz"),
  ]);

  const checks: Record<string, unknown> = { db: dbResult };
  let critical = !dbResult.ok;
  if ("skipped" in accountsResult) {
    checks.takosumiAccounts = { skipped: true };
  } else {
    checks.takosumiAccounts = accountsResult;
    if (!accountsResult.ok) {
      critical = true;
    }
  }

  const status = critical ? 503 : 200;
  return c.json(
    {
      ok: !critical,
      status: critical ? "degraded" : "ok",
      service: "takos-worker",
      checks,
    },
    status,
  );
});

// DoS body-size gate. Mounted before route dispatch so that oversized
// requests are rejected before any handler touches the body. The resolver
// picks the cap per request:
//
// - Git Smart HTTP push uploads can carry large pack files (cap at 256 MiB).
// - Retired deployment routes still accept source descriptors (a few MiB max).
// - Everything else falls back to the strict 1 MiB default.
//
// Missing `Content-Length` is allowed by default so chunked-encoded uploads
// and runtimes that omit the header still pass through; the cap is enforced
// whenever the header is present.
app.use(
  "*",
  bodyLimitMiddleware((request) => {
    const pathname = new URL(request.url).pathname;
    if (isGitSmartHttpPath(pathname)) {
      return { maxBytes: GIT_SMART_HTTP_BODY_LIMIT_BYTES };
    }
    if (
      pathname === "/api/public/v1/deployments" ||
      pathname.startsWith("/api/public/v1/deployments/")
    ) {
      return { maxBytes: DEPLOY_BODY_LIMIT_BYTES };
    }
    return { maxBytes: DEFAULT_BODY_LIMIT_BYTES };
  }),
);

// Origin-based CSRF gate. Registered after the /health probe and body-limit
// guard so health checks from external monitors don't need to satisfy the
// origin allowlist, but before any forwarder or public route runs so
// cookie-auth mutations are blocked at the edge. Bearer-auth requests pass
// through (token in header is itself the CSRF mitigation) and reads
// (GET/HEAD) are never gated. Enforcement is opt-in via the
// `TAKOS_API_CSRF_ALLOWED_ORIGINS` env list.
app.use("*", csrfMiddleware());

app.all("*", async (c, next) => {
  const pathname = new URL(c.req.raw.url).pathname;
  const executionCtx = maybeExecutionCtx(c);
  if (isRetiredTakosOAuthProviderPath(pathname)) {
    return retiredTakosOAuthProviderResponse();
  }
  if (isRetiredTakosBillingPath(pathname)) {
    return retiredTakosBillingResponse();
  }
  if (isRetiredTakosPublicationsPath(pathname)) {
    return retiredTakosPublicationsResponse();
  }
  if (isAccountControlPath(pathname)) {
    return await forwardAccountControlRequest(c.req.raw, c.env, executionCtx);
  }
  if (isAppInstallationsControlPath(pathname)) {
    return await forwardAppInstallationsControlRequest(
      c.req.raw,
      c.env,
      executionCtx,
    );
  }
  if (isProfileControlPath(pathname)) {
    return await forwardProfileControlRequest(c.req.raw, c.env, executionCtx);
  }
  if (isSetupControlPath(pathname)) {
    return await forwardSetupControlRequest(c.req.raw, c.env, executionCtx);
  }
  if (isRunsControlPath(pathname, c.req.raw.method)) {
    return await forwardRunsControlRequest(c.req.raw, c.env, executionCtx);
  }
  if (isSpaceToolsControlPath(pathname, c.req.raw.method)) {
    return await forwardSpaceToolsControlRequest(
      c.req.raw,
      c.env,
      executionCtx,
    );
  }
  if (isThreadsControlPath(pathname, c.req.raw.method)) {
    return await forwardThreadsControlRequest(c.req.raw, c.env, executionCtx);
  }
  return await next();
});

registerSpacesPublicRoutes(app);

registerExplorePublicRoutes(app);

registerRunsPublicRoutes(app);

registerThreadsPublicRoutes(app);

registerDeploymentsPublicRoutes(app);

registerRepositoriesPublicRoutes(app);

registerRuntimeGatewayPublicRoutes(app);

app.all("*", async (c, next) => {
  const pathname = new URL(c.req.raw.url).pathname;
  if (!isGitSmartHttpPath(pathname)) return await next();
  const response = await proxyGitSmartHttpRequest(c.req.raw, {
    env: c.env,
    executionCtx: maybeExecutionCtx(c),
  });
  if (response instanceof Response) return response;
  return c.json(response, 500);
});

// Global error boundary. Hono's default uncaught-exception handler returns a
// bare, un-enveloped 500 that can echo the error message back to the client.
// This handler logs the full error server-side (with a correlation id) and
// returns the closed `commonError` envelope so the response body never leaks
// `err.message` / `err.stack`. The correlation id is echoed via the
// `x-request-id` response header — the envelope shape stays `{ error: { code,
// message } }`. It is a handler, not middleware, so registration order relative
// to routes does not matter.
app.onError((err, c) => {
  const requestId = resolveRequestId(c.req);
  console.error(`[takos-worker][error] requestId=${requestId}`, err);
  return c.json(commonError("INTERNAL_ERROR", "Internal error"), 500, {
    [REQUEST_ID_HEADER]: requestId,
  });
});

if (import.meta.main) {
  const port = Number(getEnv("PORT") ?? "8787");
  const env = await createStandaloneRuntimeEnvWithRetry();
  Bun.serve({ port, fetch: (request) => app.fetch(request, env) });
}

const defaultExport = typeof Bun === "undefined" || !import.meta.main
  ? app
  : {};

export default defaultExport;

function maybeExecutionCtx(
  c: { executionCtx?: PlatformExecutionContext },
): PlatformExecutionContext | undefined {
  try {
    return c.executionCtx;
  } catch {
    return undefined;
  }
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStandaloneStartupError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /ECONNREFUSED|ECONNRESET|connection terminated|database system is starting up|timeout|timed out/i
    .test(message);
}

async function createStandaloneRuntimeEnvWithRetry(): Promise<ApiBindings> {
  let lastError: unknown;
  for (
    let attempt = 1;
    attempt <= STANDALONE_STARTUP_RETRY_ATTEMPTS;
    attempt++
  ) {
    try {
      return await createStandaloneRuntimeEnv();
    } catch (error) {
      lastError = error;
      if (!isRetryableStandaloneStartupError(error)) {
        throw error;
      }
      if (attempt === STANDALONE_STARTUP_RETRY_ATTEMPTS) {
        break;
      }
      console.warn(
        `[takos-worker] standalone env init failed; retrying (${attempt}/${STANDALONE_STARTUP_RETRY_ATTEMPTS})`,
        error instanceof Error ? error.message : String(error),
      );
      await delay(STANDALONE_STARTUP_RETRY_DELAY_MS);
    }
  }
  throw lastError;
}

async function createStandaloneRuntimeEnv(): Promise<ApiBindings> {
  const dbUrl = getEnv("DATABASE_URL") ??
    getEnv("POSTGRES_URL") ??
    getEnv("DB_CONNECTION_STRING");
  if (dbUrl && !getEnv("DATABASE_URL")) {
    setEnv("DATABASE_URL", dbUrl);
  }

  const { createNodeWebEnv } = await import(
    "../../worker/node-platform/env-builder.ts"
  );
  const env = await createNodeWebEnv() as ApiBindings;
  for (const key of STANDALONE_ENV_KEYS) {
    const value = getEnv(key);
    if (value !== undefined) {
      (env as Record<string, unknown>)[key] = value;
    }
  }
  return env;
}
