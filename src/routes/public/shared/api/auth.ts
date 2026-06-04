import { deleteEnv, envObject, getEnv, setEnv } from "@takos/worker-platform-utils/runtime-env";
import type { Context } from "hono";
import type { TakosumiActorContext } from "takosumi-contract-v2/internal/rpc";
import type { SqlDatabaseBinding } from "takos-api-contract/shared/types";
import type { PlatformExecutionContext } from "takos-worker/shared/types";
import { forwardInProcessControlJsonRequest } from "../../routes/in-process-control-routes.ts";
import type { ApiBindings } from "./bindings.ts";
import {
  commonError,
  constantTimeEqual,
  copyHeaderIfPresent,
  isRecord,
  resolveRequestId,
} from "./common.ts";

export type ActorExtractionResult =
  | { ok: true; actor: TakosumiActorContext }
  | { ok: false; response: Response };

export type AuthRuntimeOptions = {
  env?: ApiBindings;
  executionCtx?: PlatformExecutionContext;
};

/**
 * Result of {@link requireDbAndActor}: on success, the `DB` binding (proven
 * non-null) plus the authenticated actor; on failure, a prepared error
 * `Response` the handler returns directly.
 */
export type RequireDbAndActorResult =
  | { ok: true; db: SqlDatabaseBinding; actor: TakosumiActorContext }
  | { ok: false; response: Response };

/**
 * Folds the DB-guard + actor-resolution preamble repeated across every public
 * route handler into one call.
 *
 * 1. Asserts the `DB` binding is configured (500 `INTERNAL_ERROR` otherwise).
 * 2. Seeds the actor `requestId` from {@link resolveRequestId} — honoring the
 *    caller-supplied `x-request-id` — instead of minting a throwaway UUID. The
 *    global middleware in `index.ts` echoes that same id on the response, so the
 *    forwarded `actor.requestId` now correlates with the `x-request-id` header
 *    and server logs (previously the two never matched).
 * 3. Runs {@link actorFromAuthenticatedRequest}, folding an auth failure into
 *    its prepared `Response`.
 *
 * Pass `spaceId` for `/api/spaces/:spaceId/*` routes so the signed actor context
 * carries the space binding.
 */
export async function requireDbAndActor(
  c: Context<{ Bindings: ApiBindings }>,
  spaceId?: string,
): Promise<RequireDbAndActorResult> {
  const db = c.env?.DB;
  if (!db) {
    return {
      ok: false,
      response: c.json(
        commonError("INTERNAL_ERROR", "database is not configured"),
        { status: 500 },
      ),
    };
  }
  const actorResult = await actorFromAuthenticatedRequest(
    c.req.raw,
    resolveRequestId(c.req),
    spaceId,
    { env: c.env },
  );
  if (!actorResult.ok) return { ok: false, response: actorResult.response };
  return { ok: true, db, actor: actorResult.actor };
}

export async function actorFromAuthenticatedRequest(
  request: Request,
  requestId: string,
  spaceIdOrOptions?: string | AuthRuntimeOptions,
  options: AuthRuntimeOptions = {},
): Promise<ActorExtractionResult> {
  const { spaceId, runtime } = normalizeAuthRuntimeArgs(
    spaceIdOrOptions,
    options,
  );
  if (hasTrustedActorHeaderSource(request.headers)) {
    const actor = actorFromTrustedHeaders(request, requestId, spaceId);
    if (actor) return { ok: true, actor };
    return {
      ok: false,
      response: Response.json(
        commonError("UNAUTHORIZED", "authenticated actor header is required"),
        { status: 401 },
      ),
    };
  }
  const directAuthResult = await actorFromDirectCredentials(
    request,
    requestId,
    spaceId,
    runtime,
  );
  if (directAuthResult) return directAuthResult;
  if (unauthenticatedActorHeadersAllowed()) {
    // Local internal-proxy development only: production must authenticate
    // before translating actor headers into signed internal actor context.
    return { ok: true, actor: actorFromHeaders(request, requestId, spaceId) };
  }
  return {
    ok: false,
    response: Response.json(
      commonError("UNAUTHORIZED", "authentication required"),
      { status: 401 },
    ),
  };
}

function normalizeAuthRuntimeArgs(
  spaceIdOrOptions: string | AuthRuntimeOptions | undefined,
  options: AuthRuntimeOptions,
): { spaceId?: string; runtime: AuthRuntimeOptions } {
  if (
    typeof spaceIdOrOptions === "object" && spaceIdOrOptions !== null
  ) {
    return { runtime: spaceIdOrOptions };
  }
  return { spaceId: spaceIdOrOptions, runtime: options };
}

export async function optionalActorAccountId(
  request: Request,
  requestId: string,
  options: AuthRuntimeOptions = {},
): Promise<{ actorAccountId?: string }> {
  if (hasTrustedActorHeaderSource(request.headers)) {
    const actor = actorFromTrustedHeaders(request, requestId);
    return actor ? { actorAccountId: actor.actorAccountId } : {};
  }
  if (hasDirectCredential(request.headers)) {
    const directAuthResult = await actorFromDirectCredentials(
      request,
      requestId,
      undefined,
      options,
    );
    return directAuthResult?.ok
      ? { actorAccountId: directAuthResult.actor.actorAccountId }
      : {};
  }
  if (unauthenticatedActorHeadersAllowed()) {
    const actor = actorFromHeaders(request, requestId);
    return actor.actorAccountId === "anonymous"
      ? {}
      : { actorAccountId: actor.actorAccountId };
  }
  return {};
}

/**
 * Whether raw inbound `x-takos-account-id` / `x-takos-roles` headers may be
 * translated into a trusted actor context without any credential verification.
 *
 * This is a local-development-only escape hatch. It is gated fail-closed: it is
 * honored ONLY when `TAKOS_API_ALLOW_UNAUTHENTICATED_ACTOR_HEADERS === "true"`
 * AND no `TAKOS_INTERNAL_API_SECRET` is configured. Any environment that has a
 * real auth posture (the internal proxy secret is set) refuses to trust raw
 * actor headers, so the flag cannot become a fail-open auth bypass /
 * tenant-impersonation vector if it leaks into a reachable deployment that also
 * carries production secrets. In such an environment callers must authenticate
 * via the trusted internal-secret header or direct credentials instead.
 */
function unauthenticatedActorHeadersAllowed(): boolean {
  if (
    getEnv("TAKOS_API_ALLOW_UNAUTHENTICATED_ACTOR_HEADERS") !== "true"
  ) {
    return false;
  }
  return !getEnv("TAKOS_INTERNAL_API_SECRET");
}

async function actorFromDirectCredentials(
  request: Request,
  requestId: string,
  spaceId?: string,
  options: AuthRuntimeOptions = {},
): Promise<ActorExtractionResult | null> {
  if (!hasDirectCredential(request.headers)) return null;

  const secret = getEnv("TAKOS_INTERNAL_API_SECRET");
  if (!secret || !options.env) {
    return {
      ok: false,
      response: Response.json(
        commonError("INTERNAL_ERROR", "auth verifier is not configured"),
        { status: 500 },
      ),
    };
  }

  const headers = new Headers({
    "content-type": "application/json",
    "x-takos-auth-proxy-secret": secret,
  });
  const authorization = directCredentialAuthorization(request.headers);
  if (authorization) headers.set("authorization", authorization);
  copyHeaderIfPresent(request.headers, headers, "cookie");
  copyHeaderIfPresent(request.headers, headers, "user-agent");

  const response = await forwardInProcessControlJsonRequest(
    "/internal/auth/verify",
    {
      env: options.env,
      executionCtx: options.executionCtx,
      method: "POST",
      headers,
      body: JSON.stringify({ requestId, ...(spaceId ? { spaceId } : {}) }),
    },
  ).catch(() => null);
  if (!response) {
    return {
      ok: false,
      response: Response.json(
        commonError("INTERNAL_ERROR", "auth verifier request failed"),
        { status: 502 },
      ),
    };
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      const errorBody = await commonErrorFromResponse(response) ??
        commonError(
          response.status === 403 ? "FORBIDDEN" : "UNAUTHORIZED",
          response.status === 403 ? "forbidden" : "authentication required",
        );
      return {
        ok: false,
        response: Response.json(errorBody, { status: response.status }),
      };
    }
    return {
      ok: false,
      response: Response.json(
        commonError("INTERNAL_ERROR", "auth verifier request failed"),
        { status: 502 },
      ),
    };
  }

  const body = await response.json().catch(() => null) as unknown;
  const actor = actorFromAuthVerifyResponse(body, requestId, spaceId);
  if (!actor) {
    return {
      ok: false,
      response: Response.json(
        commonError("INTERNAL_ERROR", "auth verifier returned invalid actor"),
        { status: 502 },
      ),
    };
  }
  return { ok: true, actor };
}

function hasDirectCredential(headers: Headers): boolean {
  return Boolean(
    directCredentialAuthorization(headers) ||
      headers.get("cookie"),
  );
}

function directCredentialAuthorization(headers: Headers): string | null {
  const authorization = headers.get("authorization");
  if (!authorization) return null;
  if (authorization.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length).trim();
    return isForwardableAccountsBearer(token) ? `Bearer ${token}` : null;
  }
  if (!authorization.startsWith("Basic ")) return null;
  const pat = personalAccessTokenFromBasicAuth(authorization);
  return pat ? `Bearer ${pat}` : null;
}

function personalAccessTokenFromBasicAuth(
  authorization: string,
): string | null {
  const encoded = authorization.slice("Basic ".length).trim();
  if (!encoded) return null;
  let decoded: string;
  try {
    decoded = atob(encoded);
  } catch {
    return null;
  }
  const separatorIndex = decoded.indexOf(":");
  const token =
    (separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : decoded).trim();
  return token.startsWith("takpat_") ? token : null;
}

function isRetiredAppLocalBearer(token: string): boolean {
  return token.startsWith("tak_oat_") || token.startsWith("tak_pat_");
}

function isForwardableAccountsBearer(token: string): boolean {
  if (!token || isRetiredAppLocalBearer(token)) return false;
  return token.startsWith("takpat_") || token.split(".").length === 3;
}

function actorFromAuthVerifyResponse(
  value: unknown,
  requestId: string,
  spaceId?: string,
): TakosumiActorContext | null {
  if (!isRecord(value) || !isRecord(value.actor)) return null;
  const actorAccountId = typeof value.actor.actorAccountId === "string"
    ? value.actor.actorAccountId.trim()
    : "";
  if (!actorAccountId) return null;
  const rolesValue = value.actor.roles;
  const roles = Array.isArray(rolesValue)
    ? rolesValue.filter((role): role is string =>
      typeof role === "string" && role.trim().length > 0
    ).map((role) => role.trim())
    : ["member"];
  return {
    actorAccountId,
    roles: roles.length ? roles : ["member"],
    requestId,
    ...(spaceId ? { spaceId } : {}),
  };
}

async function commonErrorFromResponse(
  response: Response,
): Promise<ReturnType<typeof commonError> | null> {
  const value = await response.json().catch(() => null) as unknown;
  if (!isRecord(value) || !isRecord(value.error)) return null;
  const code = typeof value.error.code === "string" ? value.error.code : "";
  const message = typeof value.error.message === "string"
    ? value.error.message
    : "";
  if (!code || !message) return null;
  return commonError(code, message);
}

function actorFromTrustedHeaders(
  request: Request,
  requestId: string,
  spaceId?: string,
): TakosumiActorContext | null {
  const actorAccountId = request.headers.get("x-takos-account-id")?.trim();
  if (!actorAccountId) return null;
  return actorFromHeaders(request, requestId, spaceId, actorAccountId);
}

function actorFromHeaders(
  request: Request,
  requestId: string,
  spaceId?: string,
  actorAccountId = request.headers.get("x-takos-account-id") ?? "anonymous",
): TakosumiActorContext {
  return {
    actorAccountId,
    spaceId,
    roles: (request.headers.get("x-takos-roles") ?? "member")
      .split(",")
      .map((role) => role.trim())
      .filter(Boolean),
    requestId,
  };
}

export function hasTrustedActorHeaderSource(headers: Headers): boolean {
  const expectedSecret = getEnv("TAKOS_INTERNAL_API_SECRET");
  const actualSecret = headers.get("x-takos-internal-secret");
  return Boolean(
    expectedSecret && actualSecret &&
      constantTimeEqual(actualSecret, expectedSecret),
  );
}
