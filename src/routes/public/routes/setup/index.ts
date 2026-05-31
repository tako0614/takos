import {
  commonError,
  forwardInProcessControlRequest,
} from "../in-process-control-routes.ts";
import type { ApiBindings } from "../../shared/api/bindings.ts";
import type { PlatformExecutionContext } from "takos-worker/shared/types";

const SETUP_API_PREFIX = "/api/setup";

export function isSetupControlPath(pathname: string): boolean {
  return setupBackendPath(pathname) !== null;
}

export async function forwardSetupControlRequest(
  request: Request,
  env?: ApiBindings,
  executionCtx?: PlatformExecutionContext,
): Promise<Response> {
  const requestUrl = new URL(request.url);
  const targetPath = setupBackendPath(requestUrl.pathname);
  if (!targetPath) {
    return Response.json(commonError("NOT_FOUND", "setup route not found"), {
      status: 404,
    });
  }
  return await forwardInProcessControlRequest(request, targetPath, {
    env,
    executionCtx,
  });
}

function setupBackendPath(pathname: string): string | null {
  return pathname === SETUP_API_PREFIX ||
      pathname.startsWith(`${SETUP_API_PREFIX}/`)
    ? pathname
    : null;
}
