import {
  commonError,
  forwardInProcessControlRequest,
} from "../in-process-control-routes.ts";
import type { ApiBindings } from "../../shared/api/bindings.ts";
import type { PlatformExecutionContext } from "takos-worker/shared/types";

const PROFILE_API_PREFIX = "/api/users";

export function isProfileControlPath(pathname: string): boolean {
  return profileBackendPath(pathname) !== null;
}

export async function forwardProfileControlRequest(
  request: Request,
  env?: ApiBindings,
  executionCtx?: PlatformExecutionContext,
): Promise<Response> {
  const requestUrl = new URL(request.url);
  const targetPath = profileBackendPath(requestUrl.pathname);
  if (!targetPath) {
    return Response.json(commonError("NOT_FOUND", "profile route not found"), {
      status: 404,
    });
  }
  return await forwardInProcessControlRequest(request, targetPath, {
    env,
    executionCtx,
  });
}

function profileBackendPath(pathname: string): string | null {
  return pathname === PROFILE_API_PREFIX ||
      pathname.startsWith(`${PROFILE_API_PREFIX}/`)
    ? pathname
    : null;
}
