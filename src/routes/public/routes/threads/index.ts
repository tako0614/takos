import {
  commonError,
  forwardInProcessControlRequest,
} from "../in-process-control-routes.ts";
import type { ApiBindings } from "../../shared/api/bindings.ts";
import type { PlatformExecutionContext } from "takos-worker/shared/types";

const THREADS_API_PREFIX = "/api/threads";

export function isThreadsControlPath(
  pathname: string,
  method = "GET",
): boolean {
  return threadsBackendPath(pathname, method) !== null;
}

export async function forwardThreadsControlRequest(
  request: Request,
  env?: ApiBindings,
  executionCtx?: PlatformExecutionContext,
): Promise<Response> {
  const requestUrl = new URL(request.url);
  const targetPath = threadsBackendPath(requestUrl.pathname, request.method);
  if (!targetPath) {
    return Response.json(commonError("NOT_FOUND", "threads route not found"), {
      status: 404,
    });
  }
  return await forwardInProcessControlRequest(request, targetPath, {
    env,
    executionCtx,
  });
}

function threadsBackendPath(pathname: string, method: string): string | null {
  if (isAppsApiOwnedThreadsPath(pathname, method)) {
    return null;
  }
  if (
    pathname === THREADS_API_PREFIX ||
    pathname.startsWith(`${THREADS_API_PREFIX}/`)
  ) {
    return pathname;
  }

  const parts = pathname.split("/").filter(Boolean);
  return parts.length >= 4 &&
      parts[0] === "api" &&
      parts[1] === "spaces" &&
      parts[3] === "threads"
    ? pathname
    : null;
}

function isAppsApiOwnedThreadsPath(pathname: string, method: string): boolean {
  const upperMethod = method.toUpperCase();
  if (
    upperMethod !== "GET" &&
    upperMethod !== "POST" &&
    upperMethod !== "PATCH" &&
    upperMethod !== "DELETE"
  ) return false;
  const parts = pathname.split("/").filter(Boolean);
  if (upperMethod !== "GET") {
    if (
      upperMethod === "POST" &&
      parts.length === 4 &&
      parts[0] === "api" &&
      parts[1] === "spaces" &&
      parts[2].length > 0 &&
      parts[3] === "threads"
    ) return true;
    if (parts[0] !== "api" || parts[1] !== "threads" || !parts[2]) return false;
    if (
      (upperMethod === "PATCH" || upperMethod === "DELETE") &&
      parts.length === 3
    ) return true;
    if (upperMethod === "POST" && parts.length === 4) {
      return parts[3] === "messages" ||
        parts[3] === "runs" ||
        parts[3] === "share" ||
        parts[3] === "archive" ||
        parts[3] === "unarchive";
    }
    return upperMethod === "POST" &&
      parts.length === 6 &&
      parts[3] === "shares" &&
      parts[4].length > 0 &&
      parts[5] === "revoke";
  }
  if (
    parts.length === 3 &&
    parts[0] === "api" &&
    parts[1] === "threads" &&
    parts[2].length > 0
  ) {
    return true;
  }
  if (
    parts.length === 4 &&
    parts[0] === "api" &&
    parts[1] === "spaces" &&
    parts[2].length > 0 &&
    parts[3] === "threads"
  ) {
    return true;
  }
  if (
    parts.length === 5 &&
    parts[0] === "api" &&
    parts[1] === "spaces" &&
    parts[2].length > 0 &&
    parts[3] === "threads" &&
    parts[4] === "search"
  ) {
    return true;
  }
  if (
    parts.length === 5 &&
    parts[0] === "api" &&
    parts[1] === "threads" &&
    parts[2].length > 0 &&
    parts[3] === "messages" &&
    parts[4] === "search"
  ) {
    return true;
  }
  return parts.length === 4 &&
    parts[0] === "api" &&
    parts[1] === "threads" &&
    parts[2].length > 0 &&
    (parts[3] === "runs" ||
      parts[3] === "history" ||
      parts[3] === "export" ||
      parts[3] === "messages" ||
      parts[3] === "shares");
}
