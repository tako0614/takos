import {
  commonError,
  forwardInProcessControlRequest,
} from "../in-process-control-routes.ts";
import type { ApiBindings } from "../../shared/api/bindings.ts";
import type { PlatformExecutionContext } from "takos-worker/shared/types";

const RUNS_API_PREFIX = "/api/runs";
const ARTIFACTS_API_PREFIX = "/api/artifacts";

export function isRunsControlPath(pathname: string, method = "GET"): boolean {
  return runsBackendPath(pathname, method) !== null;
}

export async function forwardRunsControlRequest(
  request: Request,
  env?: ApiBindings,
  executionCtx?: PlatformExecutionContext,
): Promise<Response> {
  const requestUrl = new URL(request.url);
  const targetPath = runsBackendPath(requestUrl.pathname, request.method);
  if (!targetPath) {
    return Response.json(commonError("NOT_FOUND", "runs route not found"), {
      status: 404,
    });
  }
  return await forwardInProcessControlRequest(request, targetPath, {
    env,
    executionCtx,
  });
}

function runsBackendPath(pathname: string, method: string): string | null {
  if (isAppsApiOwnedRunsPath(pathname, method)) {
    return null;
  }
  return pathname === RUNS_API_PREFIX ||
      pathname.startsWith(`${RUNS_API_PREFIX}/`) ||
      pathname === ARTIFACTS_API_PREFIX ||
      pathname.startsWith(`${ARTIFACTS_API_PREFIX}/`)
    ? pathname
    : null;
}

function isAppsApiOwnedRunsPath(pathname: string, method: string): boolean {
  const upperMethod = method.toUpperCase();
  if (upperMethod !== "GET" && upperMethod !== "POST") return false;
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "api") return false;
  if (
    upperMethod === "GET" &&
    parts.length === 3 && parts[1] === "runs" && parts[2].length > 0
  ) {
    return true;
  }
  if (
    upperMethod === "GET" &&
    parts.length === 4 &&
    parts[1] === "runs" &&
    parts[2].length > 0 &&
    (parts[3] === "events" || parts[3] === "replay" || parts[3] === "sse" ||
      parts[3] === "ws")
  ) {
    return true;
  }
  if (
    upperMethod === "POST" &&
    parts.length === 4 &&
    parts[1] === "runs" &&
    parts[2].length > 0 &&
    parts[3] === "cancel"
  ) {
    return true;
  }
  if (
    (upperMethod === "GET" || upperMethod === "POST") &&
    parts.length === 4 &&
    parts[1] === "runs" &&
    parts[2].length > 0 &&
    parts[3] === "artifacts"
  ) {
    return true;
  }
  return upperMethod === "GET" &&
    parts.length === 3 &&
    parts[1] === "artifacts" &&
    parts[2].length > 0;
}
