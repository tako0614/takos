import {
  commonError,
  forwardInProcessControlRequest,
} from "../in-process-control-routes.ts";
import type { ApiBindings } from "../../shared/api/bindings.ts";
import type { PlatformExecutionContext } from "takos-worker/shared/types";

const ACCOUNT_UPSTREAM_PREFIXES = [
  "/api/auth",
  "/api/me",
] as const;

const AUTH_UPSTREAM_PATHS = new Set([
  "/auth/oidc/login",
  "/auth/oidc/callback",
  "/auth/logout",
]);

const REMOVED_ACCOUNT_PATH_PREFIXES = [
  "/api/me/personal-access-tokens",
] as const;

export function isAccountControlPath(pathname: string): boolean {
  return accountBackendPath(pathname) !== null;
}

export async function forwardAccountControlRequest(
  request: Request,
  env?: ApiBindings,
  executionCtx?: PlatformExecutionContext,
): Promise<Response> {
  const requestUrl = new URL(request.url);
  const targetPath = accountBackendPath(requestUrl.pathname);
  if (!targetPath) {
    return Response.json(commonError("NOT_FOUND", "account route not found"), {
      status: 404,
    });
  }
  return await forwardInProcessControlRequest(request, targetPath, {
    env,
    executionCtx,
  });
}

function accountBackendPath(pathname: string): string | null {
  if (AUTH_UPSTREAM_PATHS.has(pathname)) return pathname;
  if (pathname === "/auth" || pathname.startsWith("/auth/")) return null;
  if (
    REMOVED_ACCOUNT_PATH_PREFIXES.some((prefix) =>
      pathname === prefix || pathname.startsWith(`${prefix}/`)
    )
  ) {
    return null;
  }
  return ACCOUNT_UPSTREAM_PREFIXES.some((prefix) =>
      pathname === prefix || pathname.startsWith(`${prefix}/`)
    )
    ? pathname
    : null;
}
