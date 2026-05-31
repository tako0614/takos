import {
  commonError,
  forwardInProcessControlRequest,
} from "../in-process-control-routes.ts";
import type { ApiBindings } from "../../shared/api/bindings.ts";
import type { PlatformExecutionContext } from "takos-worker/shared/types";

export function isSpaceToolsControlPath(
  pathname: string,
  method = "GET",
): boolean {
  return spaceToolsBackendPath(pathname, method) !== null;
}

export async function forwardSpaceToolsControlRequest(
  request: Request,
  env?: ApiBindings,
  executionCtx?: PlatformExecutionContext,
): Promise<Response> {
  const requestUrl = new URL(request.url);
  const targetPath = spaceToolsBackendPath(requestUrl.pathname, request.method);
  if (!targetPath) {
    return Response.json(commonError("NOT_FOUND", "tools route not found"), {
      status: 404,
    });
  }
  return await forwardInProcessControlRequest(request, targetPath, {
    env,
    executionCtx,
  });
}

function spaceToolsBackendPath(
  pathname: string,
  method: string,
): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (method.toUpperCase() === "GET" && isSpaceToolsReadPath(parts)) {
    return null;
  }
  return parts.length >= 4 &&
      parts[0] === "api" &&
      parts[1] === "spaces" &&
      parts[3] === "tools"
    ? pathname
    : null;
}

function isSpaceToolsReadPath(parts: string[]): boolean {
  return (parts.length === 4 || parts.length === 5) &&
    parts[0] === "api" &&
    parts[1] === "spaces" &&
    parts[3] === "tools";
}
