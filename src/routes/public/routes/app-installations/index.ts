import {
  commonError,
  forwardInProcessControlRequest,
} from "../in-process-control-routes.ts";
import type { ApiBindings } from "../../shared/api/bindings.ts";
import type { PlatformExecutionContext } from "takos-worker/shared/types";

export function isAppInstallationsControlPath(pathname: string): boolean {
  return appInstallationsBackendPath(pathname) !== null;
}

export async function forwardAppInstallationsControlRequest(
  request: Request,
  env?: ApiBindings,
  executionCtx?: PlatformExecutionContext,
): Promise<Response> {
  const requestUrl = new URL(request.url);
  const targetPath = appInstallationsBackendPath(requestUrl.pathname);
  if (!targetPath) {
    return Response.json(
      commonError("NOT_FOUND", "app-installations route not found"),
      { status: 404 },
    );
  }

  return await forwardInProcessControlRequest(request, targetPath, {
    env,
    executionCtx,
  });
}

function appInstallationsBackendPath(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (
    parts.length < 4 ||
    parts[0] !== "api" ||
    parts[1] !== "spaces" ||
    parts[3] !== "app-installations"
  ) {
    return null;
  }

  return pathname.replace(/^\/api/, "");
}
